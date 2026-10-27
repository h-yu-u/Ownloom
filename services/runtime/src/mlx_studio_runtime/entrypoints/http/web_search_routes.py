"""Explicit search configuration save/test endpoints; GET never probes a provider."""

from collections.abc import Awaitable, Callable
from typing import Any, Literal

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from mlx_studio_runtime.composition_root import RuntimeApplication


class WebSettingsView(BaseModel):
    id: str
    revision: int
    provider: Literal["tavily"]
    baseUrl: str
    credentialConfigured: bool
    ready: bool


class WebSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    provider: Literal["tavily"] = "tavily"
    base_url: str = Field(min_length=1, max_length=2000)
    api_key: SecretStr | None = Field(default=None, max_length=500)


class WebSettingsTest(BaseModel):
    config_id: str = Field(min_length=1, max_length=100)
    config_revision: int = Field(ge=1)


class WebTestView(WebSettingsView):
    ok: bool
    elapsedMs: int
    partial: bool | None = None
    sourceCount: int | None = None
    readCount: int | None = None


def register_web_search_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    dependencies = [Depends(authenticate)]

    @app.get(
        "/internal/v1/settings/web-search",
        dependencies=dependencies,
        response_model=WebSettingsView,
    )
    async def settings() -> dict[str, Any]:
        return service.web_settings.public()

    @app.put(
        "/internal/v1/settings/web-search",
        dependencies=dependencies,
        response_model=WebSettingsView,
    )
    async def save(body: WebSettingsUpdate) -> dict[str, Any]:
        key = body.api_key.get_secret_value() if body.api_key else None
        return await service.web_settings.save(body.expected_revision, body.base_url, key)

    @app.post(
        "/internal/v1/settings/web-search/test",
        dependencies=dependencies,
        response_model=WebTestView,
    )
    async def test(body: WebSettingsTest) -> dict[str, Any]:
        return await service.web_settings.test(body.config_id, body.config_revision)
