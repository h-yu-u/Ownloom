"""HTTP protocol adaptation; business behavior lives in application use cases."""

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.mtp import MtpSettings
from mlx_studio_runtime.entrypoints.http.contracts import (
    ModelPathRequest,
    ModelPullRequest,
    ModelView,
)
from mlx_studio_runtime.entrypoints.http.download_contracts import DownloadView
from mlx_studio_runtime.entrypoints.http.draft_contracts import DraftSettingsRequest
from mlx_studio_runtime.entrypoints.http.model_catalog import register_model_catalog_routes
from mlx_studio_runtime.entrypoints.http.mtp_contracts import MtpSettingsRequest


def _not_found(code: str, message: str) -> RuntimeErrorInfo:
    return RuntimeErrorInfo(code, message)


def register_model_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    @app.get(
        "/internal/v1/models", dependencies=[Depends(authenticate)], response_model=list[ModelView]
    )
    async def list_models() -> list[dict[str, Any]]:
        return service.catalog.list_models()

    register_model_catalog_routes(app, authenticate)

    @app.post(
        "/internal/v1/models/{model_id}/draft",
        dependencies=[Depends(authenticate)],
        response_model=ModelView,
    )
    async def configure_draft(model_id: str, body: DraftSettingsRequest) -> dict[str, Any]:
        return await service.acceleration.configure_draft(model_id, body.settings())

    @app.post(
        "/internal/v1/models/{model_id}/mtp",
        dependencies=[Depends(authenticate)],
        response_model=ModelView,
    )
    async def configure_mtp(model_id: str, body: MtpSettingsRequest) -> dict[str, Any]:
        settings = MtpSettings(body.draftPath, body.blockSize) if body.draftPath else None
        return await service.acceleration.configure(model_id, settings)

    @app.get(
        "/internal/v1/models/{model_id}",
        dependencies=[Depends(authenticate)],
        response_model=ModelView,
    )
    async def get_model(model_id: str) -> dict[str, Any]:
        model = next(
            (model for model in service.catalog.list_models() if model["id"] == model_id), None
        )
        if model is None:
            raise RuntimeFault(_not_found("MODEL_NOT_FOUND", "找不到此模型"))
        return model

    @app.post("/internal/v1/models/scan", dependencies=[Depends(authenticate)])
    async def scan_model(body: ModelPathRequest) -> dict[str, Any]:
        return await service.catalog.scan_model(Path(body.path))

    @app.post("/internal/v1/models/import", dependencies=[Depends(authenticate)])
    async def import_model(body: ModelPathRequest) -> dict[str, Any]:
        return await service.catalog.scan_model(Path(body.path))

    @app.get(
        "/internal/v1/downloads",
        dependencies=[Depends(authenticate)],
        response_model=list[DownloadView],
    )
    async def downloads() -> list[dict[str, Any]]:
        return service.downloads.list()

    @app.post(
        "/internal/v1/downloads", dependencies=[Depends(authenticate)], response_model=DownloadView
    )
    async def start_download(body: ModelPullRequest) -> dict[str, Any]:
        return service.downloads.start(body.repo_id, body.revision)

    @app.post(
        "/internal/v1/downloads/{identifier}/pause",
        dependencies=[Depends(authenticate)],
        response_model=DownloadView,
    )
    async def pause_download(identifier: str) -> dict[str, Any]:
        return await service.downloads.stop(identifier)

    @app.post(
        "/internal/v1/downloads/{identifier}/cancel",
        dependencies=[Depends(authenticate)],
        response_model=DownloadView,
    )
    async def cancel_download(identifier: str) -> dict[str, Any]:
        return await service.downloads.stop(identifier, cancel=True)

    @app.post(
        "/internal/v1/downloads/{identifier}/resume",
        dependencies=[Depends(authenticate)],
        response_model=DownloadView,
    )
    async def resume_download(identifier: str) -> dict[str, Any]:
        return service.downloads.resume(identifier)

    @app.post("/internal/v1/models/pull", dependencies=[Depends(authenticate)])
    async def pull_model(body: ModelPullRequest) -> dict[str, str]:
        return await service.downloads.pull(body.repo_id, body.revision)

    @app.post("/internal/v1/models/{model_id}/load", dependencies=[Depends(authenticate)])
    async def load_model(model_id: str) -> dict[str, str]:
        return await service.controls.load(model_id)

    @app.post("/internal/v1/models/{model_id}/unload", dependencies=[Depends(authenticate)])
    async def unload_model(model_id: str) -> dict[str, str]:
        return await service.controls.unload(model_id)

    @app.delete("/internal/v1/models/{model_id}/registration", dependencies=[Depends(authenticate)])
    async def unregister_model(model_id: str) -> dict[str, bool]:
        return await service.model_removal.execute(model_id)

    @app.delete("/internal/v1/models/{model_id}/files", dependencies=[Depends(authenticate)])
    async def delete_model_files(model_id: str, confirm: bool = False) -> dict[str, bool]:
        if not confirm:
            raise HTTPException(status_code=400, detail="CONFIRMATION_REQUIRED")
        return await service.model_removal.execute(model_id, delete_files=True)
