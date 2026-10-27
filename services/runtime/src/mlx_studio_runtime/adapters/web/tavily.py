"""Official Tavily SDK; search parameters follow the LibreChat search integration."""

import asyncio
from datetime import datetime
from typing import Any, Literal

import httpx
from tavily import AsyncTavilyClient
from tavily.errors import (
    BadRequestError,
    ForbiddenError,
    InvalidAPIKeyError,
    MissingAPIKeyError,
    UsageLimitExceededError,
)
from tavily.errors import (
    TimeoutError as TavilyTimeoutError,
)

from mlx_studio_runtime.adapters.web.bounded_transport import BoundedTransport
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.web import PageRead, SearchHit, WebConfig, public_result_url
from mlx_studio_runtime.domain.web_freshness import freshness_window, rank_hits


class Tavily:
    async def _call(
        self,
        endpoint: Literal["search", "extract"],
        config: WebConfig,
        credential: str,
        parameters: dict[str, Any],
    ) -> dict[str, Any]:
        if not credential.strip():
            raise RuntimeFault(RuntimeErrorInfo("WEB_NOT_CONFIGURED", "请先配置搜索凭据"))
        try:
            async with httpx.AsyncClient(
                base_url=config.base_url,
                transport=BoundedTransport(),
                follow_redirects=False,
                trust_env=False,
            ) as transport:
                sdk = AsyncTavilyClient(
                    api_key=credential,
                    api_base_url=config.base_url,
                    client=transport,
                )
                operation = sdk.search if endpoint == "search" else sdk.extract
                data: Any = await operation(timeout=min(12, config.timeout_seconds), **parameters)
                if not isinstance(data, dict) or not isinstance(data.get("results"), list):
                    raise ValueError("WEB_RESPONSE_INVALID")
                return data
        except (httpx.TimeoutException, TavilyTimeoutError) as error:
            raise RuntimeFault(
                RuntimeErrorInfo("WEB_SEARCH_TIMEOUT", "联网检索超时", True)
            ) from error
        except (InvalidAPIKeyError, MissingAPIKeyError, ForbiddenError) as error:
            raise RuntimeFault(
                RuntimeErrorInfo("WEB_SEARCH_FAILED", "搜索凭据无效或没有访问权限，请检查 API Key")
            ) from error
        except UsageLimitExceededError as error:
            raise RuntimeFault(
                RuntimeErrorInfo("WEB_SEARCH_FAILED", "搜索服务额度已用尽，请检查服务账户")
            ) from error
        except (httpx.HTTPError, BadRequestError, ValueError, TypeError, AttributeError) as error:
            raise RuntimeFault(
                RuntimeErrorInfo("WEB_SEARCH_FAILED", "搜索服务请求失败", True)
            ) from error

    async def search(self, query: str, config: WebConfig, credential: str) -> list[SearchHit]:
        now = datetime.now().astimezone()
        window = freshness_window(query, now)
        # Relative ranges are hints, not an exact publication-date requirement.
        ranges = [window.time_range, None] if window else [None]
        async with asyncio.timeout(config.timeout_seconds):
            for time_range in ranges:
                data = await self._call(
                    "search",
                    config,
                    credential,
                    {
                        "query": query,
                        "search_depth": "advanced",
                        **({"time_range": time_range} if time_range else {}),
                        "include_published_date": True,
                        "include_answer": False,
                        "include_raw_content": False,
                        "include_images": False,
                        "max_results": config.max_results,
                    },
                )
                hits = rank_hits(self._hits(data, config.max_results), window, now)
                if hits:
                    return hits
        return []

    @staticmethod
    def _hits(data: dict[str, Any], limit: int) -> list[SearchHit]:
        return [
            SearchHit(
                str(item.get("title", "网页"))[:300],
                item["url"],
                item["content"][:6000] if isinstance(item.get("content"), str) else "",
                item.get("published_date") if isinstance(item.get("published_date"), str) else None,
            )
            for item in data["results"][:limit]
            if isinstance(item, dict)
            and isinstance(item.get("url"), str)
            and public_result_url(item["url"])
        ]

    async def read(self, urls: list[str], config: WebConfig, credential: str) -> list[PageRead]:
        data = await self._call("extract", config, credential, {"urls": urls, "format": "text"})
        return [
            PageRead(item["url"], item["raw_content"][:12000])
            for item in data["results"]
            if isinstance(item, dict)
            and item.get("url") in urls
            and isinstance(item.get("raw_content"), str)
            and item["raw_content"].strip()
        ]
