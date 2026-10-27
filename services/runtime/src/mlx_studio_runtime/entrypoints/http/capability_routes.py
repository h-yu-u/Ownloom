"""A scoped bearer can activate, invoke, observe and close only its own run."""

from collections.abc import Awaitable, Callable
from typing import Any, Literal

from fastapi import FastAPI, Header, Path
from pydantic import BaseModel, ConfigDict

from mlx_studio_runtime.composition_root import RuntimeApplication


class CapabilityToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["image_generate", "speech_generate"]
    args: dict[str, Any]


def register_capability_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    root = "/internal/v1/agent-capabilities"

    @app.post(root + "/activate")
    async def activate(authorization: str = Header()) -> dict[str, str]:
        return await service.capability_grants.activate(authorization.removeprefix("Bearer "))

    @app.post(root + "/tools/{invocation}")
    async def invoke(
        body: CapabilityToolRequest,
        invocation: str = Path(min_length=1, max_length=200),
        authorization: str = Header(),
    ) -> dict[str, Any]:
        return await service.capability_grants.invoke(
            authorization, invocation, body.action, body.args
        )

    @app.post(root + "/close")
    async def close(authorization: str = Header()) -> dict[str, bool]:
        await service.capability_grants.close_run(authorization)
        return {"closed": True}
