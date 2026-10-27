"""Conversation and message persistence."""

from __future__ import annotations

import base64
import json
import sqlite3
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.attachment_reference_repository import (
    AttachmentReferences,
)
from mlx_studio_runtime.adapters.persistence.attachment_repository import (
    AttachmentRepository,
)
from mlx_studio_runtime.adapters.persistence.conversation_titles import (
    assign_input_title,
    backfill_conversation_titles,
)
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class ConversationRepository:
    def __init__(
        self,
        database: SQLiteDatabase,
        attachments: AttachmentRepository,
    ) -> None:
        self.database = database
        self.attachments = attachments
        backfill_conversation_titles(database)

    def list(self) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT id,title,model_id,parameters_json,created_at,updated_at,pinned,"
            "web_search_enabled "
            "FROM conversations ORDER BY pinned DESC, updated_at DESC, rowid DESC"
        ).fetchall()
        return [_conversation(row) for row in rows]

    def get(
        self, conversation_id: str, limit: int | None = None, before: str | None = None
    ) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT id,title,model_id,parameters_json,created_at,updated_at,pinned,"
            "web_search_enabled "
            "FROM conversations WHERE id=?",
            (conversation_id,),
        ).fetchone()
        if row is None:
            return None
        conversation = _conversation(row)
        cursor = None
        if before:
            try:
                cursor = json.loads(base64.urlsafe_b64decode(before))
                if (
                    not isinstance(cursor, list)
                    or len(cursor) != 2
                    or not all(isinstance(x, int) for x in cursor)
                ):
                    raise ValueError("cursor")
            except (ValueError, TypeError) as error:
                raise RuntimeFault(RuntimeErrorInfo("INVALID_CURSOR", "历史游标无效")) from error
        if limit is not None and not 1 <= limit <= 100:
            raise RuntimeFault(RuntimeErrorInfo("INVALID_LIMIT", "每页最多 100 条"))
        rows = self.database.connection.execute(
            "SELECT id,role,content,model_snapshot_json,parameters_json,created_at,turn_id,rowid "
            "FROM messages WHERE conversation_id=? AND is_active=1 "
            + ("AND (created_at,rowid)<(?,?) " if cursor else "")
            + (
                "ORDER BY created_at DESC,rowid DESC LIMIT ?"
                if limit
                else "ORDER BY created_at,rowid"
            ),
            (conversation_id, *(cursor or []), *([limit + 1] if limit else [])),
        ).fetchall()
        next_cursor = None
        if limit:
            if len(rows) > limit:
                last = rows[limit - 1]
                next_cursor = base64.urlsafe_b64encode(
                    json.dumps([last[5], last[7]]).encode()
                ).decode()
            rows = list(reversed(rows[:limit]))
        conversation["nextCursor"] = next_cursor
        messages = [
            {
                "id": item[0],
                "role": item[1],
                "content": item[2],
                "modelSnapshot": json.loads(item[3]) if item[3] else None,
                "parameters": json.loads(item[4]),
                "createdAt": item[5],
                "attachments": self.attachments.for_message(item[0]),
                "turnId": item[6] or item[0],
            }
            for item in rows
        ]
        for message in messages:
            message["sources"] = message["parameters"].get("sources", [])
            versions = message["parameters"].get("attachmentPreparations", {})
            for attachment in message["attachments"]:
                attachment["preparationId"] = versions.get(attachment["id"])
        conversation["messages"] = order_messages_by_turn(messages)
        return conversation

    def page(
        self, conversation_id: str, before: str | None = None, limit: int = 50
    ) -> dict[str, Any] | None:
        item = self.get(conversation_id, limit, before)
        if item:
            for message in item["messages"]:
                message["parameters"] = {
                    key: value
                    for key, value in message["parameters"].items()
                    if key not in {"acceptedSnapshot", "acceptedContextJobId", "contextHead"}
                }
        return item

    def handoff_messages(
        self, conversation_id: str, identifiers: list[str]
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        for identifier in identifiers:
            row = self.database.connection.execute(
                "SELECT id,role,content FROM messages WHERE conversation_id=? AND id=?",
                (conversation_id, identifier),
            ).fetchone()
            if row is None:
                raise RuntimeFault(RuntimeErrorInfo("MESSAGE_NOT_FOUND", "来源消息不存在"))
            messages.append(
                {
                    "id": row[0],
                    "role": row[1],
                    "content": row[2],
                    "attachments": self.attachments.for_message(row[0]),
                }
            )
        return messages

    def save(self, item: dict[str, Any]) -> None:
        now = int(time.time())
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO conversations("
                "id,title,model_id,parameters_json,created_at,updated_at"
                ") VALUES(?,?,?,?,?,?)",
                (
                    item["id"],
                    item["title"],
                    item.get("modelId"),
                    json.dumps(item.get("parameters", {})),
                    now,
                    now,
                ),
            )

    def rename(self, conversation_id: str, title: str) -> bool:
        return self.update_metadata(conversation_id, title, None)

    def update_metadata(
        self,
        conversation_id: str,
        title: str | None,
        pinned: bool | None,
        web_search_enabled: bool | None = None,
    ) -> bool:
        with self.database.transaction() as connection:
            cursor = connection.execute(
                "UPDATE conversations SET title=COALESCE(?,title), "
                "pinned=COALESCE(?,pinned), "
                "web_search_enabled=COALESCE(?,web_search_enabled), "
                "parameters_json=CASE WHEN ? IS NULL THEN parameters_json "
                "ELSE json_set(parameters_json,'$.titleSource','manual') END, "
                "updated_at=CASE WHEN ? IS NULL THEN updated_at ELSE ? END WHERE id=?",
                (
                    title,
                    pinned,
                    web_search_enabled,
                    title,
                    title,
                    int(time.time()),
                    conversation_id,
                ),
            )
        return cursor.rowcount > 0

    def delete(self, conversation_id: str) -> bool:
        with self.database.transaction() as connection:
            active = connection.execute(
                "SELECT 1 FROM jobs WHERE kind='chat' AND json_valid(request_json) "
                "AND json_extract(request_json,'$.conversationId')=? "
                "AND state IN ('queued','preparing','running','cancelling')",
                (conversation_id,),
            ).fetchone()
            if active:
                raise RuntimeFault(
                    RuntimeErrorInfo("CONVERSATION_IN_USE", "会话仍有任务运行", True)
                )
            connection.execute(
                "DELETE FROM jobs WHERE kind='chat' AND json_valid(request_json) "
                "AND json_extract(request_json,'$.conversationId')=?",
                (conversation_id,),
            )
            cursor = connection.execute(
                "DELETE FROM conversations WHERE id=?",
                (conversation_id,),
            )
        return cursor.rowcount > 0

    def last_assistant_message_id(self, conversation_id: str) -> str | None:
        row = self.database.connection.execute(
            "SELECT id FROM messages WHERE conversation_id=? AND role='assistant' AND is_active=1 "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (conversation_id,),
        ).fetchone()
        return str(row[0]) if row is not None else None

    def delete_last_assistant_message(self, conversation_id: str) -> bool:
        message_id = self.last_assistant_message_id(conversation_id)
        if message_id is None:
            return False
        with self.database.transaction() as connection:
            connection.execute("UPDATE messages SET is_active=0 WHERE id=?", (message_id,))
        return True

    def save_message(
        self,
        item: dict[str, Any],
        replace_message_id: str | None = None,
    ) -> None:
        now = int(time.time())
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO messages(id,conversation_id,role,content,model_snapshot_json,"
                "parameters_json,created_at,turn_id) VALUES(?,?,?,?,?,?,?,?)",
                (
                    item["id"],
                    item["conversationId"],
                    item["role"],
                    item["content"],
                    json.dumps(item["modelSnapshot"]) if item.get("modelSnapshot") else None,
                    json.dumps(item.get("parameters", {})),
                    now,
                    item.get("turnId"),
                ),
            )
            for position, attachment_id in enumerate(item.get("attachmentIds", [])):
                AttachmentReferences(self.database).require_active(attachment_id)
                connection.execute(
                    "INSERT INTO message_attachments(message_id,attachment_id,position) "
                    "VALUES(?,?,?)",
                    (item["id"], attachment_id, position),
                )
            if replace_message_id:
                connection.execute(
                    "UPDATE messages SET is_active=0 WHERE id=? AND conversation_id=? "
                    "AND role='assistant'",
                    (replace_message_id, item["conversationId"]),
                )
            connection.execute(
                "UPDATE conversations SET updated_at=? WHERE id=?",
                (now, item["conversationId"]),
            )
            if item["role"] == "user":
                assign_input_title(connection, item["conversationId"], item["content"])


def _conversation(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row[0],
        "title": row[1],
        "modelId": row[2],
        "parameters": json.loads(row[3]),
        "createdAt": row[4],
        "updatedAt": row[5],
        "pinned": bool(row[6]),
        "webSearchEnabled": bool(row[7]),
    }


def order_messages_by_turn(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    turns: dict[str, list[dict[str, Any]]] = {}
    turn_order: list[str] = []
    for message in messages:
        turn_id = str(message.get("turnId") or message["id"])
        if turn_id not in turns:
            turns[turn_id] = []
            turn_order.append(turn_id)
        turns[turn_id].append(message)
    ordered: list[dict[str, Any]] = []
    for turn_id in turn_order:
        ordered.extend(sorted(turns[turn_id], key=lambda item: item["role"] != "user"))
    return ordered
