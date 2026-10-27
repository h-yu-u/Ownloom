"""Authenticated originals, immutable previews and revisioned draft leases."""

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Query, Request
from fastapi.responses import FileResponse

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.entrypoints.http.attachment_contracts import (
    AttachmentMetadata,
    DraftSelection,
    TextPreview,
)


def register_attachment_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    dependencies = [Depends(authenticate)]

    @app.post(
        "/internal/v1/attachments", dependencies=dependencies, response_model=AttachmentMetadata
    )
    async def upload(
        request: Request,
        filename: str = Query(default="image", max_length=500),
        client_upload_id: str | None = Query(default=None, min_length=1, max_length=100),
        draft_id: str | None = Query(default=None, min_length=1, max_length=100),
        draft_revision: int | None = Query(default=None, ge=0),
    ) -> dict[str, Any]:
        return await service.attachments.upload(
            request.stream(), filename, client_upload_id, draft_id, draft_revision
        )

    @app.get("/internal/v1/attachments/{attachment_id}", dependencies=dependencies)
    async def read(attachment_id: str) -> FileResponse:
        path, item = service.attachments.read(attachment_id)
        return FileResponse(path, media_type=item["mimeType"], filename=item["originalName"])

    @app.get(
        "/internal/v1/attachments/{attachment_id}/metadata",
        dependencies=dependencies,
        response_model=AttachmentMetadata,
    )
    async def metadata(attachment_id: str) -> dict[str, Any]:
        return service.attachments.metadata(attachment_id)

    @app.post(
        "/internal/v1/attachments/{attachment_id}/retry",
        dependencies=dependencies,
        response_model=AttachmentMetadata,
    )
    async def retry(attachment_id: str) -> dict[str, Any]:
        return service.attachments.retry(attachment_id)

    @app.get(
        "/internal/v1/attachments/{attachment_id}/preview",
        dependencies=dependencies,
        response_model=TextPreview,
        responses={200: {"content": {"image/webp": {}}}},
    )
    async def preview(
        attachment_id: str,
        preparation_id: str,
        view: Literal["thumbnail", "text"],
        block_start: int = Query(default=0, ge=0),
        block_limit: int = Query(default=30, ge=1, le=50),
        page: int | None = Query(default=None, ge=1),
    ) -> Any:
        result = service.attachments.preview(
            attachment_id, preparation_id, view, block_start, block_limit, page
        )
        return FileResponse(result, media_type="image/webp") if isinstance(result, Path) else result

    @app.put("/internal/v1/attachment-drafts/{draft_id}", dependencies=dependencies)
    async def update_draft(draft_id: str, body: DraftSelection) -> dict[str, object]:
        return service.attachment_references.update_draft(
            draft_id, body.revision, body.attachment_ids, body.client_upload_ids
        )

    @app.delete("/internal/v1/attachment-drafts/{draft_id}", dependencies=dependencies)
    async def close_draft(draft_id: str) -> dict[str, str]:
        return service.attachment_references.close_draft(draft_id)
