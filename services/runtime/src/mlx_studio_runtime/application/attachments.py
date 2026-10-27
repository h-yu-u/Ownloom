"""Upload and preparation orchestration. CPU work runs outside the inference lease."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.attachment_ports import (
    DerivedStorage,
    OriginalStorage,
    PreparationRunner,
    PreparationStore,
)
from mlx_studio_runtime.domain.attachments import USABLE_STATES
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

LOGGER = logging.getLogger("mlx_studio.attachments")


class Attachments:
    def __init__(
        self,
        originals: OriginalStorage,
        preparations: PreparationStore,
        derivatives: DerivedStorage,
        executor: PreparationRunner,
    ) -> None:
        self.originals = originals
        self.preparations = preparations
        self.derivatives = derivatives
        self.executor = executor
        self.tasks: dict[str, asyncio.Task[None]] = {}

    async def upload(
        self,
        chunks: AsyncIterator[bytes],
        filename: str,
        client_upload_id: str | None = None,
        draft_id: str | None = None,
        draft_revision: int | None = None,
    ) -> dict[str, Any]:
        item = await self.originals.upload(
            chunks, filename, client_upload_id, draft_id, draft_revision
        )
        self.ensure(item["id"])
        return self.metadata(item["id"])

    def read(self, attachment_id: str) -> tuple[Path, dict[str, Any]]:
        return self.originals.read(attachment_id)

    def ensure(self, attachment_id: str) -> dict[str, Any]:
        _, item = self.read(attachment_id)
        preparation = self.preparations.create(item)
        preparation_id = preparation["preparationId"]
        if preparation["state"] == "queued" and preparation_id not in self.tasks:
            task = asyncio.create_task(self._prepare(item, preparation_id))
            self.tasks[preparation_id] = task
            task.add_done_callback(lambda _: self.tasks.pop(preparation_id, None))
        return preparation

    def metadata(self, attachment_id: str) -> dict[str, Any]:
        _, item = self.read(attachment_id)
        result = {key: value for key, value in item.items() if key != "relativePath"}
        preparation = self.preparations.latest(attachment_id)
        result["processing"] = self._public(preparation) if preparation else None
        return result

    def retry(self, attachment_id: str) -> dict[str, Any]:
        self.ensure(attachment_id)
        return self.metadata(attachment_id)

    async def require_ready(self, attachment_id: str) -> dict[str, Any]:
        preparation = self.ensure(attachment_id)
        task = self.tasks.get(preparation["preparationId"])
        if task:
            await asyncio.shield(task)
        return self.frozen(attachment_id, preparation["preparationId"])

    def frozen(self, attachment_id: str, preparation_id: str | None = None) -> dict[str, Any]:
        _, item = self.read(attachment_id)
        preparation = (
            self.preparations.get(attachment_id, preparation_id)
            if preparation_id
            else (self.preparations.latest(attachment_id))
        )
        if not preparation or preparation["state"] not in USABLE_STATES:
            code = (
                "ATTACHMENT_NEEDS_OCR"
                if preparation and preparation["state"] == "needs_ocr"
                else "ATTACHMENT_NOT_READY"
            )
            raise RuntimeFault(RuntimeErrorInfo(code, "附件尚未准备完成或不可读取", True))
        return {**item, "preparationId": preparation["preparationId"], "processing": preparation}

    def blocks(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        return self.derivatives.blocks(item["processing"])

    def image_path(self, item: dict[str, Any]) -> str:
        manifest = item["processing"]["manifest"]["modelInput"]
        return str(
            self.derivatives.file(item["preparationId"], manifest["path"], manifest["sha256"])
        )

    def preview(
        self,
        attachment_id: str,
        preparation_id: str,
        view: str,
        block_start: int = 0,
        block_limit: int = 30,
        page: int | None = None,
    ) -> Path | dict[str, Any]:
        preparation = self.preparations.get(attachment_id, preparation_id)
        if view == "text" and preparation["state"] == "needs_ocr":
            _, original = self.read(attachment_id)
            item = {**original, "preparationId": preparation_id, "processing": preparation}
        else:
            item = self.frozen(attachment_id, preparation_id)
        if view == "thumbnail" and item["kind"] == "image":
            thumbnail = item["processing"]["manifest"]["thumbnail"]
            return self.derivatives.file(preparation_id, thumbnail["path"], thumbnail["sha256"])
        if view == "text" and item["kind"] == "document":
            blocks = self.blocks(item)
            selected = [block for block in blocks if page is None or block.get("page") == page]
            return {
                "preparationId": preparation_id,
                "blocks": selected[block_start : block_start + block_limit],
                "totalBlocks": len(selected),
                "coverage": item["processing"]["coverage"],
                "warnings": item["processing"]["warnings"],
            }
        raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_TYPE_UNSUPPORTED", "此预览不适用于该附件"))

    async def _prepare(self, item: dict[str, Any], preparation_id: str) -> None:
        owner = str(uuid.uuid4())
        if not self.preparations.claim(item["id"], preparation_id, owner):
            return
        staging: Path | None = None
        published = False
        committed = False
        try:
            staging = self.derivatives.staging(preparation_id, owner)
            source, _ = self.read(item["id"])
            manifest = await self.executor.run(source, staging, item["format"])
            self.derivatives.publish(staging, preparation_id)
            published = True
            committed = self.preparations.commit(preparation_id, owner, manifest)
        except asyncio.CancelledError:
            self.preparations.commit(
                preparation_id, owner, {"state": "cancelled", "errorCode": "RUNTIME_INTERRUPTED"}
            )
            raise
        except Exception as error:  # Preparation task boundary.
            code = error.info.code if isinstance(error, RuntimeFault) else "ATTACHMENT_PARSE_FAILED"
            self.preparations.commit(preparation_id, owner, {"state": "failed", "errorCode": code})
            LOGGER.warning("Preparation failed: %s", code, extra={"preparation_id": preparation_id})
        finally:
            if staging is not None:
                self.derivatives.discard(staging)
            if published and not committed:
                self.derivatives.remove(preparation_id)

    async def close(self) -> None:
        tasks = tuple(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    @staticmethod
    def _public(preparation: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value
            for key, value in preparation.items()
            if key not in {"manifest", "cacheKey", "attachmentId", "attemptNo"}
        }
