"""Product transport only; Node is the single owner of Coding state and execution."""

import secrets
import time
from collections.abc import Awaitable, Callable
from typing import Any

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.generated.coding_rpc import RpcMethod


class CodingGateway:
    def __init__(self, request: Callable[[RpcMethod, dict[str, object]], Awaitable[Any]]) -> None:
        self.request = request
        self.credentials: dict[str, float] = {}

    def issue(self) -> str:
        now = time.monotonic()
        self.credentials = {
            token: expiry for token, expiry in self.credentials.items() if expiry > now
        }
        token = secrets.token_urlsafe(32)
        self.credentials[token] = now + 2700
        return token

    def authorized(self, authorization: str | None) -> bool:
        if not authorization or not authorization.startswith("Bearer "):
            return False
        return self.credentials.get(authorization[7:], 0) > time.monotonic()

    async def call(self, method: RpcMethod, params: dict[str, object]) -> Any:
        return await self.request(method, params)

    async def model_call(
        self,
        method: RpcMethod,
        params: dict[str, object],
        base_url: str,
        model_id: str,
        context_window: int,
        identity: tuple[str, str],
    ) -> Any:
        if not base_url.startswith("http://127.0.0.1:"):
            raise RuntimeFault(
                RuntimeErrorInfo("LOCAL_PROVIDER_REQUIRED", "推理接口必须位于回环地址")
            )
        return await self.call(
            method,
            {
                **params,
                "provider": {
                    "modelId": model_id,
                    "baseUrl": base_url.rstrip("/") + "/internal/v1/inference",
                    "token": self.issue(),
                    "contextWindow": context_window,
                    "fingerprint": identity[0],
                    "engineVersion": identity[1],
                },
            },
        )
