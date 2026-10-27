"""Bounded raw uploads, idempotent originals and image-only managed paths."""

import hashlib
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from mlx_studio_runtime.adapters.attachment_formats import detect_format
from mlx_studio_runtime.adapters.persistence.attachment_reference_repository import (
    AttachmentReferences,
)
from mlx_studio_runtime.adapters.persistence.attachment_repository import AttachmentRepository
from mlx_studio_runtime.domain.attachments import MAX_FILE_BYTES, attachment_type
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


async def save_attachment(
    chunks: AsyncIterator[bytes],
    filename: str,
    store: AttachmentRepository,
    root: Path,
    client_upload_id: str | None = None,
    draft_id: str | None = None,
    draft_revision: int | None = None,
) -> dict[str, Any]:
    attachment_id = str(uuid.uuid4())
    attachment_dir = root / "attachments"
    attachment_dir.mkdir(parents=True, exist_ok=True)
    temp_path = attachment_dir / f".{attachment_id}.upload"
    final_path = attachment_dir / attachment_id
    digest, size = hashlib.sha256(), 0
    safe_name = Path(filename.replace("\\", "/")).name[:180] or "attachment"
    try:
        with temp_path.open("wb") as output:
            async for chunk in chunks:
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_TOO_LARGE", "文件超过 20 MiB"))
                digest.update(chunk)
                output.write(chunk)
        mime_type = detect_format(temp_path, safe_name)
        kind, format_name = attachment_type(mime_type)
        item = {
            "id": attachment_id,
            "sha256": digest.hexdigest(),
            "mimeType": mime_type,
            "kind": kind,
            "format": format_name,
            "sizeBytes": size,
            "relativePath": f"attachments/{attachment_id}",
            "originalName": safe_name,
            "clientUploadId": client_upload_id,
        }
        with store.database.transaction():
            previous = store.find_upload(client_upload_id) if client_upload_id else None
            if previous:
                require_same_upload(previous, item)
                item = previous
            else:
                temp_path.replace(final_path)
                store.save(item)
            AttachmentReferences(store.database).attach_upload(
                draft_id, draft_revision, client_upload_id, item["id"]
            )
        return {
            key: value
            for key, value in item.items()
            if key not in {"relativePath", "clientUploadId"}
        }
    except BaseException:
        final_path.unlink(missing_ok=True)
        raise
    finally:
        temp_path.unlink(missing_ok=True)


class AttachmentFiles:
    def __init__(self, store: AttachmentRepository, media_path: Path) -> None:
        self.store = store
        self.media_path = media_path

    async def upload(
        self,
        chunks: AsyncIterator[bytes],
        filename: str,
        client_upload_id: str | None = None,
        draft_id: str | None = None,
        draft_revision: int | None = None,
    ) -> dict[str, Any]:
        return await save_attachment(
            chunks,
            filename,
            self.store,
            self.media_path,
            client_upload_id,
            draft_id,
            draft_revision,
        )

    def read(self, attachment_id: str) -> tuple[Path, dict[str, Any]]:
        items = self.store.get_many([attachment_id])
        if not items:
            raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_NOT_FOUND", "找不到此附件"))
        item = items[0]
        root = (self.media_path / "attachments").resolve()
        path = (self.media_path / item["relativePath"]).resolve()
        if path.parent != root or not path.is_file() or path.is_symlink():
            raise RuntimeFault(
                RuntimeErrorInfo("ATTACHMENT_NOT_FOUND", "附件文件已不存在或路径无效")
            )
        return path, item

    def paths(self, attachment_ids: list[str]) -> list[str]:
        paths: list[str] = []
        for attachment_id in attachment_ids:
            path, item = self.read(attachment_id)
            if item["kind"] != "image":
                raise RuntimeFault(
                    RuntimeErrorInfo("IMAGE_FORMAT_UNSUPPORTED", "参考图和蒙版必须为图片")
                )
            paths.append(str(path))
        return paths


def require_same_upload(previous: dict[str, Any], item: dict[str, Any]) -> None:
    if any(
        previous[key] != item[key] for key in ("sha256", "mimeType", "sizeBytes", "originalName")
    ):
        raise RuntimeFault(RuntimeErrorInfo("UPLOAD_IDEMPOTENCY_CONFLICT", "上传编号对应不同文件"))
