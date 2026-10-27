"""Public settings never expose credential references or resolved secrets."""

import asyncio
import time
from typing import Any

from mlx_studio_runtime.application.web_ports import SecretStore, WebConfigStore
from mlx_studio_runtime.application.web_retrieval import WebRetrieval
from mlx_studio_runtime.domain.web import WebConfig, normalize_base_url


class WebSettings:
    def __init__(
        self, configs: WebConfigStore, secrets: SecretStore, retrieval: WebRetrieval
    ) -> None:
        self.configs = configs
        self.secrets = secrets
        self.retrieval = retrieval

    def public(self, config: WebConfig | None = None) -> dict[str, Any]:
        config = config or self.configs.current()
        return {
            "id": config.id if config else "search_default",
            "revision": config.revision if config else 0,
            "provider": "tavily",
            "baseUrl": config.base_url if config else "https://api.tavily.com",
            "credentialConfigured": bool(config and config.secret_ref),
            "ready": bool(config and self.configs.tested(config.id, config.revision)),
        }

    async def save(
        self, expected_revision: int, base_url: str, api_key: str | None
    ) -> dict[str, Any]:
        base_url = normalize_base_url(base_url)
        current = self.configs.current()
        reference = await asyncio.to_thread(self.secrets.put, api_key) if api_key else None
        try:
            config = self.configs.save(
                expected_revision, base_url, reference or (current.secret_ref if current else None)
            )
        except BaseException:
            if reference:
                await asyncio.to_thread(self.secrets.delete, reference)
            raise
        return self.public(config)

    async def test(self, config_id: str, revision: int) -> dict[str, Any]:
        config = self.configs.get(config_id, revision)
        start = time.monotonic()

        async def phase(_: str) -> None:
            pass

        result = await self.retrieval.retrieve("MLX", config, phase)
        self.configs.mark_tested(config.id, config.revision)
        return {
            "ok": True,
            "elapsedMs": round((time.monotonic() - start) * 1000),
            "partial": result["partial"],
            "sourceCount": len(result["sources"]),
            "readCount": result["readCount"],
            **self.public(config),
        }
