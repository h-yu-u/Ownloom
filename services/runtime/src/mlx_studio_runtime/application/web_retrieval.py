"""Bounded provider search followed by at most three hosted page extractions."""

import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from mlx_studio_runtime.application.web_ports import (
    PageReader,
    ResultPolicy,
    SearchProvider,
    SecretStore,
)
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.web import PageRead, SearchHit, WebConfig, public_result_url
from mlx_studio_runtime.domain.web_freshness import freshness_window, rank_hits


class WebRetrieval:
    def __init__(
        self, search: SearchProvider, reader: PageReader, secrets: SecretStore, policy: ResultPolicy
    ) -> None:
        self.search = search
        self.reader = reader
        self.secrets = secrets
        self.policy = policy
        self.semaphore = asyncio.Semaphore(4)

    async def retrieve(
        self, query: str, config: WebConfig, phase: Callable[[str], Awaitable[None]]
    ) -> dict[str, Any]:
        if not query.strip() or len(query) > 2000:
            raise RuntimeFault(
                RuntimeErrorInfo("WEB_QUERY_REQUIRED", "请提供不超过 2000 字的明确搜索问题")
            )
        if not config.secret_ref:
            raise RuntimeFault(RuntimeErrorInfo("WEB_NOT_CONFIGURED", "请先配置搜索凭据"))
        try:
            async with asyncio.timeout(config.timeout_seconds), self.semaphore:
                credential = await asyncio.to_thread(self.secrets.resolve, config.secret_ref)
                await phase("searching")
                now = datetime.now().astimezone()
                window = freshness_window(query, now)
                hits = await self.search.search(query, config, credential)
                selected = self._select_results(rank_hits(hits, window, now))
                read_urls = [url for _, url in selected if await self.policy.allowed(url)]
                await phase("reading_sources")
                reads = await self._read(read_urls, config, credential)
                sources = self._sources(selected, reads, datetime.now(UTC).isoformat())
                if not sources:
                    raise RuntimeFault(
                        RuntimeErrorInfo(
                            "WEB_NO_RESULTS",
                            "搜索服务已连接，但未取得可用正文或摘要，请更换问题后重试",
                            True,
                        )
                    )
                return {
                    "sources": sources,
                    "partial": len(reads) < len(selected),
                    "readCount": len(reads),
                    "failedCount": len(selected) - len(reads),
                }
        except TimeoutError as error:
            raise RuntimeFault(
                RuntimeErrorInfo("WEB_SEARCH_TIMEOUT", "联网检索超过总时限", True)
            ) from error

    @staticmethod
    def _sources(
        selected: list[tuple[SearchHit, str]], reads: list[PageRead], retrieved_at: str
    ) -> list[dict[str, Any]]:
        by_url = {item.url: item.text for item in reads}
        sources: list[dict[str, Any]] = []
        for hit, url in selected:
            text = by_url.get(url) or hit.snippet
            if not text.strip():
                continue
            sources.append(
                {
                    "id": f"w{len(sources) + 1}",
                    "kind": "web",
                    "title": hit.title,
                    "url": url,
                    "retrievedAt": retrieved_at,
                    "publishedAt": hit.published_at,
                    "representation": "page_excerpt" if url in by_url else "snippet_only",
                    "contentHash": hashlib.sha256(text.encode()).hexdigest(),
                    "text": text,
                }
            )
        return sources

    @staticmethod
    def _select_results(hits: list[SearchHit]) -> list[tuple[SearchHit, str]]:
        selected = []
        seen: set[str] = set()
        for hit in hits:
            url = public_result_url(hit.url)
            if url and url not in seen:
                selected.append((hit, url))
                seen.add(url)
            if len(selected) == 3:
                break
        return selected

    async def _read(self, urls: list[str], config: WebConfig, credential: str) -> list[PageRead]:
        limit = asyncio.Semaphore(2)

        async def read_one(url: str) -> list[PageRead]:
            async with limit:
                try:
                    return await self.reader.read([url], config, credential)
                except RuntimeFault:
                    return []  # The search snippet is retained and explicitly labelled.

        results = await asyncio.gather(*(read_one(url) for url in urls))
        return [item for group in results for item in group]
