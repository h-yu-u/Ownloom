"""Owner-checked immutable preparation attempts on the Supervisor connection."""

import hashlib
import json
import time
import uuid
from importlib.metadata import version
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.attachments import PREPARATION_VERSION, USABLE_STATES
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class PreparationRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def latest(self, attachment_id: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT * FROM attachment_preparations WHERE attachment_id=? ORDER "
            "BY rowid DESC LIMIT 1",
            (attachment_id,),
        ).fetchone()
        return self._view(dict(row)) if row else None

    def get(self, attachment_id: str, preparation_id: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            "SELECT * FROM attachment_preparations WHERE attachment_id=? AND id=?",
            (attachment_id, preparation_id),
        ).fetchone()
        if row is None:
            raise RuntimeFault(RuntimeErrorInfo("PREPARATION_CONTENT_MISSING", "找不到此准备版本"))
        return self._view(dict(row))

    def create(self, item: dict[str, Any]) -> dict[str, Any]:
        parser = {"pdf": "pypdf", "docx": "python-docx"}.get(
            item["format"], "pillow" if item["kind"] == "image" else None
        )
        parser_version = version(parser) if parser else "utf8-strict-1"
        cache_key = hashlib.sha256(
            f"{item['sha256']}:{item['mimeType']}:{parser_version}:{PREPARATION_VERSION}".encode()
        ).hexdigest()
        with self.database.transaction() as connection:
            previous = self.latest(item["id"])
            if (
                previous
                and previous["cacheKey"] == cache_key
                and previous["state"] in (USABLE_STATES | {"queued", "preparing", "needs_ocr"})
            ):
                return previous
            attempt = int(previous["attemptNo"]) + 1 if previous else 1
            preparation_id = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO attachment_preparations(id,attachment_id,source_sha256,cache_key,"
                "attempt_no,state,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)",
                (
                    preparation_id,
                    item["id"],
                    item["sha256"],
                    cache_key,
                    attempt,
                    int(time.time()),
                    int(time.time()),
                ),
            )
        return self.get(item["id"], preparation_id)

    def claim(self, attachment_id: str, preparation_id: str, owner: str) -> bool:
        with self.database.transaction() as connection:
            return (
                connection.execute(
                    "UPDATE attachment_preparations SET state='preparing',owner_token=?,"
                    "revision=revision+1,updated_at=? WHERE id=? AND "
                    "attachment_id=? AND state='queued'",
                    (owner, int(time.time()), preparation_id, attachment_id),
                ).rowcount
                == 1
            )

    def commit(self, preparation_id: str, owner: str, manifest: dict[str, Any]) -> bool:
        with self.database.transaction() as connection:
            return (
                connection.execute(
                    "UPDATE attachment_preparations SET state=?,manifest_json=?,error_code=?,"
                    "revision=revision+1,updated_at=? WHERE id=? AND "
                    "owner_token=? AND state='preparing'",
                    (
                        manifest["state"],
                        json.dumps(manifest),
                        manifest.get("errorCode"),
                        int(time.time()),
                        preparation_id,
                        owner,
                    ),
                ).rowcount
                == 1
            )

    def recover(self) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE attachment_preparations SET "
                "state='failed',error_code='RUNTIME_INTERRUPTED',"
                "revision=revision+1 WHERE state IN ('queued','preparing')"
            )

    @staticmethod
    def _view(row: dict[str, Any]) -> dict[str, Any]:
        manifest = json.loads(row["manifest_json"])
        return {
            "preparationId": row["id"],
            "attachmentId": row["attachment_id"],
            "revision": row["revision"],
            "state": row["state"],
            "cacheKey": row["cache_key"],
            "attemptNo": row["attempt_no"],
            "pageCount": manifest.get("pageCount"),
            "coverage": manifest.get("coverage", {}),
            "warnings": manifest.get("warnings", []),
            "errorCode": row["error_code"],
            "retryable": row["state"] in {"failed", "cancelled"},
            "manifest": manifest,
        }
