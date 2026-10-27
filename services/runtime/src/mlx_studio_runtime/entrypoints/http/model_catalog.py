"""Authenticated model-discovery route and its generated response contract."""

import asyncio
from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, Query
from pydantic import BaseModel

from mlx_studio_runtime.adapters.huggingface_catalog import search_mlx_models
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class HubModelOption(BaseModel):
    repo_id: str
    downloads: int
    likes: int
    task: str | None
    updated_at: str | None


def register_model_catalog_routes(
    app: FastAPI,
    authenticate: Callable[..., Awaitable[None]],
) -> None:
    @app.get(
        "/internal/v1/models/catalog",
        dependencies=[Depends(authenticate)],
        response_model=list[HubModelOption],
    )
    async def model_catalog(
        query: str = Query(default="", max_length=100),
        limit: int = Query(default=40, ge=1, le=50),
    ) -> list[HubModelOption]:
        try:
            models = await asyncio.wait_for(
                asyncio.to_thread(search_mlx_models, query, limit),
                timeout=15,
            )
        except TimeoutError as error:
            raise RuntimeFault(
                RuntimeErrorInfo(
                    "HF_CATALOG_NOT_AVAILABLE",
                    "Hugging Face 响应超时，请稍后重试。",
                    retryable=True,
                )
            ) from error
        return [
            HubModelOption(
                repo_id=model.repo_id,
                downloads=model.downloads,
                likes=model.likes,
                task=model.task,
                updated_at=model.updated_at,
            )
            for model in models
        ]
