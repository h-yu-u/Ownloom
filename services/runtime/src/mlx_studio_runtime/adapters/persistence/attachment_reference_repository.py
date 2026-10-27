"""Attachment liveness, revisioned draft leases and official owner references."""

import hashlib
import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class AttachmentReferences:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def require_active(self, attachment_id: str) -> None:
        row = self.database.connection.execute(
            "SELECT storage_state FROM attachments WHERE id=?", (attachment_id,)
        ).fetchone()
        if row is None or row[0] != "active":
            raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_NOT_FOUND", "附件不存在或正在删除"))

    def job(self, job_id: str, usage: str, items: list[dict[str, Any]]) -> None:
        for position, item in enumerate(items):
            self.require_active(item["id"])
            self.database.connection.execute(
                "INSERT OR IGNORE INTO job_attachment_refs(job_id,usage,position,attachment_id,"
                "preparation_id,origin_turn_id) VALUES(?,?,?,?,?,?)",
                (
                    job_id,
                    usage,
                    position,
                    item["id"],
                    item.get("preparationId"),
                    item.get("originTurnId"),
                ),
            )

    def artifact(self, artifact_id: str, usage: str, ids: list[str]) -> None:
        for position, attachment_id in enumerate(ids):
            self.require_active(attachment_id)
            self.database.connection.execute(
                "INSERT INTO artifact_attachment_refs VALUES(?,?,?,?)",
                (artifact_id, usage, position, attachment_id),
            )

    def update_draft(
        self, draft_id: str, revision: int, ids: list[str], uploads: list[str]
    ) -> dict[str, object]:
        selection = {"attachment_ids": sorted(set(ids)), "client_upload_ids": sorted(set(uploads))}
        raw = json.dumps(selection, sort_keys=True)
        digest = hashlib.sha256(raw.encode()).hexdigest()
        with self.database.transaction() as connection:
            previous = connection.execute(
                "SELECT revision,state,selection_sha256 FROM attachment_drafts WHERE id=?",
                (draft_id,),
            ).fetchone()
            if previous and previous[1] == "closed":
                raise RuntimeFault(RuntimeErrorInfo("DRAFT_CLOSED", "草稿已关闭"))
            if previous and (
                revision < previous[0] or (revision == previous[0] and digest != previous[2])
            ):
                raise RuntimeFault(RuntimeErrorInfo("DRAFT_REVISION_CONFLICT", "草稿版本已变化"))
            for attachment_id in ids:
                self.require_active(attachment_id)
            connection.execute(
                "INSERT INTO attachment_drafts VALUES(?,?,'open',?,?,?) ON CONFLICT(id) DO UPDATE "
                "SET revision=excluded.revision,selection_json=excluded.selection_json,"
                "selection_sha256=excluded.selection_sha256,expires_at=excluded.expires_at",
                (draft_id, revision, raw, digest, int(time.time()) + 3600),
            )
            connection.execute("DELETE FROM attachment_draft_refs WHERE draft_id=?", (draft_id,))
            resolved = list(ids)
            for upload in uploads:
                row = connection.execute(
                    "SELECT id FROM attachments WHERE client_upload_id=? AND "
                    "storage_state='active'",
                    (upload,),
                ).fetchone()
                if row:
                    resolved.append(row[0])
            for attachment_id in set(resolved):
                connection.execute(
                    "INSERT INTO attachment_draft_refs VALUES(?,?)", (draft_id, attachment_id)
                )
        return {"draftId": draft_id, "revision": revision, "state": "open"}

    def attach_upload(
        self, draft_id: str | None, revision: int | None, upload_id: str | None, attachment_id: str
    ) -> None:
        if not draft_id or not upload_id:
            return
        row = self.database.connection.execute(
            "SELECT revision,state,selection_json FROM attachment_drafts WHERE id=?", (draft_id,)
        ).fetchone()
        if (
            row
            and row[0] == revision
            and row[1] == "open"
            and upload_id in (json.loads(row[2])["client_upload_ids"])
        ):
            self.require_active(attachment_id)
            self.database.connection.execute(
                "INSERT OR IGNORE INTO attachment_draft_refs VALUES(?,?)", (draft_id, attachment_id)
            )

    def close_draft(self, draft_id: str) -> dict[str, str]:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO attachment_drafts VALUES(?,0,'closed','{}','',0) "
                "ON CONFLICT(id) DO UPDATE SET state='closed',selection_json='{}'",
                (draft_id,),
            )
            connection.execute("DELETE FROM attachment_draft_refs WHERE draft_id=?", (draft_id,))
        return {"state": "closed"}
