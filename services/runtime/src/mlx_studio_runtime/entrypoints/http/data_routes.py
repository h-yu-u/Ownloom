"""Authenticated explicit cleanup, recovery, protection and owner-coordinated export."""

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.entrypoints.http.temporary_file import TemporaryFileResponse


class ResourceProtection(BaseModel):
    owner: str = Field(min_length=1, max_length=200)
    seconds: int = Field(default=86400, ge=0, le=604800)


class TrashEntry(BaseModel):
    id: str
    kind: str


class CleanupCandidate(BaseModel):
    id: str
    bytes: int
    name: str


class StorageView(BaseModel):
    bytes: int
    categories: dict[str, int]
    automaticCleanup: bool
    trash: list[TrashEntry]
    candidates: list[CleanupCandidate]


class TaskSummary(BaseModel):
    owner: str
    id: str
    state: str
    phase: str
    sessionId: str | None = None
    needsApproval: bool = False
    errorCode: str | None = None
    target: str
    title: str | None = None
    kind: str | None = None
    groupId: str | None = None
    parentId: str | None = None
    createdAt: int | None = None


class RestorePreview(BaseModel):
    id: str
    version: int
    files: int
    bytes: int
    requiresRestart: bool
    warnings: list[str]


def register_data_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    dependencies = [Depends(authenticate)]

    @app.get("/internal/v1/tasks", dependencies=dependencies, response_model=list[TaskSummary])
    async def tasks() -> list[dict[str, Any]]:
        return await service.data.tasks()

    @app.get("/internal/v1/storage", dependencies=dependencies, response_model=StorageView)
    async def storage() -> dict[str, Any]:
        return service.storage.overview()

    @app.post("/internal/v1/storage/cleanup", dependencies=dependencies)
    async def cleanup() -> dict[str, int]:
        return service.storage.cleanup()

    @app.post("/internal/v1/storage/trash/{identifier}/restore", dependencies=dependencies)
    async def restore(identifier: str) -> dict[str, bool]:
        service.storage.restore(identifier)
        return {"restored": True}

    @app.delete("/internal/v1/image-artifacts/{identifier}", dependencies=dependencies)
    async def recycle(identifier: str) -> dict[str, bool]:
        service.storage.recycle_image(identifier)
        return {"recycled": True}

    @app.post("/internal/v1/resources/{identifier}/protection", dependencies=dependencies)
    async def protect(identifier: str, body: ResourceProtection) -> dict[str, bool]:
        service.storage.protect(identifier, body.owner, body.seconds)
        return {"protected": body.seconds > 0}

    @app.post("/internal/v1/storage/backup", dependencies=dependencies)
    async def backup() -> FileResponse:
        return TemporaryFileResponse(
            await service.data.backup(),
            service.data.release_backup,
        )

    @app.post(
        "/internal/v1/storage/restore/preview",
        dependencies=dependencies,
        response_model=RestorePreview,
    )
    async def inspect_backup(request: Request) -> dict[str, Any]:
        identifier, path = service.profiles.upload_path()
        total = 0
        try:
            with path.open("wb") as output:
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > 4 * 1024**3:
                        raise HTTPException(413, "BACKUP_TOO_LARGE")
                    output.write(chunk)
            return await service.profiles.inspect(identifier)
        except BaseException:
            service.profiles.discard_upload(identifier)
            raise

    @app.delete("/internal/v1/storage/restore/{identifier}", dependencies=dependencies)
    async def discard_preview(identifier: str) -> dict[str, bool]:
        service.profiles.discard_upload(identifier)
        return {"discarded": True}

    @app.post("/internal/v1/storage/restore/{identifier}/activate", dependencies=dependencies)
    async def activate_backup(identifier: str) -> dict[str, bool]:
        await service.data.restore_profile(identifier)
        return {"requiresRestart": True}

    @app.post("/internal/v1/storage/restore/rollback", dependencies=dependencies)
    async def rollback_backup() -> dict[str, bool]:
        return service.profiles.rollback()
