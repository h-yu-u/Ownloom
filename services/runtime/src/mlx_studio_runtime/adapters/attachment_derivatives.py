"""Managed immutable derivative directories with content verification."""

import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class AttachmentDerivatives:
    def __init__(self, media_path: Path) -> None:
        self.root = media_path / "attachment-derived"

    def _directory(self, preparation_id: str) -> Path:
        uuid.UUID(preparation_id)
        return self.root / preparation_id

    def staging(self, preparation_id: str, owner: str) -> Path:
        uuid.UUID(preparation_id)
        uuid.UUID(owner)
        directory = self.root / ".pending" / f"{preparation_id}-{owner}"
        directory.mkdir(parents=True, exist_ok=False)
        return directory

    def publish(self, staging: Path, preparation_id: str) -> None:
        staging.rename(self._directory(preparation_id))

    def discard(self, staging: Path) -> None:
        if staging.parent == self.root / ".pending":
            shutil.rmtree(staging, ignore_errors=True)

    def remove(self, preparation_id: str) -> None:
        shutil.rmtree(self._directory(preparation_id), ignore_errors=True)

    def file(self, preparation_id: str, name: str, sha256: str) -> Path:
        if name not in {"preview.webp", "model-input.png", "blocks.jsonl"}:
            raise RuntimeFault(RuntimeErrorInfo("PREPARATION_CONTENT_MISSING", "派生内容无效"))
        directory = self._directory(preparation_id).resolve()
        candidate = directory / name
        if (
            candidate.is_symlink()
            or not candidate.is_file()
            or candidate.resolve().parent != directory
        ):
            raise RuntimeFault(RuntimeErrorInfo("PREPARATION_CONTENT_MISSING", "派生内容不存在"))
        if hashlib.sha256(candidate.read_bytes()).hexdigest() != sha256:
            raise RuntimeFault(RuntimeErrorInfo("PREPARATION_CONTENT_MISSING", "派生内容校验失败"))
        return candidate

    def blocks(self, preparation: dict[str, Any]) -> list[dict[str, Any]]:
        path = self.file(
            preparation["preparationId"], "blocks.jsonl", preparation["manifest"]["blocksHash"]
        )
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
