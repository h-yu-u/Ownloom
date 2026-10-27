"""Self-contained snapshots and their attachment references commit together."""

import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.attachment_reference_repository import (
    AttachmentReferences,
)
from mlx_studio_runtime.adapters.persistence.context_revisions import ContextRevisions
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.chat_context import fingerprint
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class ChatContextRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database
        self.references = AttachmentReferences(database)
        self.revisions = ContextRevisions(database)

    def busy(self, conversation_id: str) -> str | None:
        row = self.database.connection.execute(
            "SELECT id FROM jobs WHERE kind='chat' AND json_valid(request_json) "
            "AND json_extract(request_json,'$.conversationId')=? "
            "AND state IN ('queued','preparing','running','cancelling')",
            (conversation_id,),
        ).fetchone()
        return row[0] if row else None

    def job(self, job_id: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            "SELECT state,request_json FROM jobs WHERE id=?", (job_id,)
        ).fetchone()
        if not row:
            raise RuntimeFault(RuntimeErrorInfo("JOB_NOT_FOUND", "找不到此任务"))
        return {"jobId": job_id, "state": row[0], "request": json.loads(row[1])}

    def reference(self, job_id: str, usage: str, items: list[dict[str, Any]]) -> None:
        self.references.job(job_id, usage, items)

    def save(
        self, job_id: str, conversation_id: str, turn_id: str, snapshot: dict[str, Any]
    ) -> None:
        messages = snapshot.get("messages", [])
        stored = {
            key: value for key, value in snapshot.items() if key not in {"messages", "prompt"}
        }
        stored["contextHead"] = self.revisions.freeze(messages)
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO chat_contexts VALUES(?,?,?,1,?,?,?) "
                "ON CONFLICT(job_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, "
                "snapshot_sha256=excluded.snapshot_sha256",
                (
                    job_id,
                    conversation_id,
                    turn_id,
                    json.dumps(stored, ensure_ascii=False),
                    fingerprint(stored),
                    int(time.time()),
                ),
            )
            self.reference(job_id, "document_context", snapshot.get("documents", []))
            self.reference(job_id, "image_context", snapshot.get("visuals", []))

    def load(self, job_id: str, conversation_id: str, turn_id: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            "SELECT snapshot_json,snapshot_sha256 FROM chat_contexts "
            "WHERE job_id=? AND conversation_id=? AND turn_id=?",
            (job_id, conversation_id, turn_id),
        ).fetchone()
        if row:
            snapshot = json.loads(row[0])
            if fingerprint(snapshot) == row[1]:
                if "contextHead" in snapshot:
                    snapshot["messages"] = self.revisions.read(snapshot["contextHead"])
                    snapshot["prompt"] = snapshot["messages"][-1]["content"]
                return snapshot
        raise RuntimeFault(
            RuntimeErrorInfo("SOURCE_SNAPSHOT_UNAVAILABLE", "资料快照不存在或校验失败")
        )

    def copy(
        self, source_job: str, job_id: str, conversation_id: str, turn_id: str
    ) -> dict[str, Any]:
        snapshot = self.load(source_job, conversation_id, turn_id)
        self.save(job_id, conversation_id, turn_id, snapshot)
        return snapshot

    def freeze_history(self, messages: list[dict[str, Any]]) -> str | None:
        return self.revisions.freeze(messages)

    def history(self, head: str | None) -> list[dict[str, Any]]:
        return self.revisions.read(head)

    def summary(self, conversation: str, boundary: str, model: str) -> dict[str, Any] | None:
        return self.revisions.summary(conversation, boundary, model)

    def save_summary(self, conversation: str, boundary: str, model: str, content: str) -> str:
        return self.revisions.save_summary(conversation, boundary, model, content)
