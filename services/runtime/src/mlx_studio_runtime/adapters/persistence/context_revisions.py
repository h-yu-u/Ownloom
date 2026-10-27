"""Content-addressed immutable message chains, shared by queued and prepared contexts."""

import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.chat_context import fingerprint
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class ContextRevisions:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database
        database.connection.executescript("""
            CREATE TABLE IF NOT EXISTS context_revisions (
                id TEXT PRIMARY KEY, parent_id TEXT, message_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS context_summaries (
                id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, boundary_id TEXT NOT NULL,
                model_id TEXT NOT NULL, template_revision TEXT NOT NULL, content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO schema_migrations
                VALUES(8, CAST(strftime('%s','now') AS INTEGER));
        """)

    def freeze(self, messages: list[dict[str, Any]]) -> str | None:
        head: str | None = None
        with self.database.transaction() as connection:
            for message in messages:
                if message.get("messageId"):
                    body = str(message["content"])
                    message = {key: value for key, value in message.items() if key != "content"}
                    message = {
                        **message,
                        "contentRef": message["messageId"],
                        "contentHash": fingerprint(body),
                    }
                identifier = fingerprint({"parent": head, "message": message})
                connection.execute(
                    "INSERT OR IGNORE INTO context_revisions VALUES(?,?,?)",
                    (identifier, head, json.dumps(message, ensure_ascii=False)),
                )
                head = identifier
        return head

    def read(self, head: str | None) -> list[dict[str, Any]]:
        if head is None:
            return []
        rows = self.database.connection.execute(
            """
            WITH RECURSIVE chain(id,parent_id,message_json,depth) AS (
                SELECT id,parent_id,message_json,0 FROM context_revisions WHERE id=?
                UNION ALL SELECT r.id,r.parent_id,r.message_json,c.depth+1
                FROM context_revisions r JOIN chain c ON r.id=c.parent_id WHERE c.depth<100000
            ) SELECT id,parent_id,message_json FROM chain ORDER BY depth DESC
        """,
            (head,),
        ).fetchall()
        messages: list[dict[str, Any]] = []
        previous = None
        for row in rows:
            message = json.loads(row[2])
            if (
                row[1] != previous
                or fingerprint({"parent": previous, "message": message}) != row[0]
            ):
                raise RuntimeFault(
                    RuntimeErrorInfo("CONTEXT_REFERENCE_INVALID", "历史版本校验失败")
                )
            previous = row[0]
            if message.get("contentRef"):
                content = self.database.connection.execute(
                    "SELECT content FROM messages WHERE id=?", (message["contentRef"],)
                ).fetchone()
                if content is None or fingerprint(content[0]) != message["contentHash"]:
                    raise RuntimeFault(
                        RuntimeErrorInfo("CONTEXT_REFERENCE_INVALID", "历史正文版本校验失败")
                    )
                message = {
                    key: value
                    for key, value in message.items()
                    if key not in {"contentRef", "contentHash"}
                }
                message["content"] = content[0]
            messages.append(message)
        if not rows or previous != head:
            raise RuntimeFault(RuntimeErrorInfo("CONTEXT_REFERENCE_INVALID", "历史版本不存在"))
        return messages

    def summary(self, conversation: str, boundary: str, model: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT id,content FROM context_summaries WHERE conversation_id=? AND boundary_id=? "
            "AND model_id=? AND template_revision='summary-v1'",
            (conversation, boundary, model),
        ).fetchone()
        return {"summaryId": row[0], "content": row[1]} if row else None

    def save_summary(self, conversation: str, boundary: str, model: str, content: str) -> str:
        identifier = fingerprint([conversation, boundary, model, "summary-v1"])
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO context_summaries VALUES(?,?,?,?,?,?,?)",
                (
                    identifier,
                    conversation,
                    boundary,
                    model,
                    "summary-v1",
                    content,
                    int(time.time()),
                ),
            )
        return identifier
