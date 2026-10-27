"""Attachment metadata persistence."""

import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.attachments import attachment_type


class AttachmentRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def save(self, item: dict[str, Any]) -> None:
        try:
            with self.database.transaction() as connection:
                connection.execute(
                    "INSERT INTO attachments(id,sha256,mime_type,size_bytes,relative_path,"
                    "original_name,created_at,client_upload_id) VALUES(?,?,?,?,?,?,?,?)",
                    (
                        item["id"],
                        item["sha256"],
                        item["mimeType"],
                        item["sizeBytes"],
                        item["relativePath"],
                        item["originalName"],
                        int(time.time()),
                        item.get("clientUploadId"),
                    ),
                )
        except BaseException:
            (self.database.media_path / str(item["relativePath"])).unlink(missing_ok=True)
            raise

    def get_many(self, attachment_ids: list[str]) -> list[dict[str, Any]] | None:
        if not attachment_ids:
            return []
        placeholders = ",".join("?" for _ in attachment_ids)
        rows = self.database.connection.execute(
            f"SELECT id,sha256,mime_type,size_bytes,relative_path,original_name "
            f"FROM attachments WHERE storage_state='active' AND id IN ({placeholders})",
            attachment_ids,
        ).fetchall()
        by_id = {row[0]: _attachment(row, include_path=True) for row in rows}
        if len(by_id) != len(set(attachment_ids)):
            return None
        return [by_id[attachment_id] for attachment_id in attachment_ids]

    def find_upload(self, upload_id: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT id FROM attachments WHERE client_upload_id=? AND storage_state='active'",
            (upload_id,),
        ).fetchone()
        items = self.get_many([row[0]]) if row else None
        return items[0] if items else None

    def for_message(self, message_id: str) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT a.id,a.sha256,a.mime_type,a.size_bytes,a.original_name "
            "FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id "
            "WHERE ma.message_id=? ORDER BY ma.position",
            (message_id,),
        ).fetchall()
        return [_attachment(row, include_path=False) for row in rows]


def _attachment(row: Any, include_path: bool) -> dict[str, Any]:
    item = {
        "id": row[0],
        "sha256": row[1],
        "mimeType": row[2],
        "sizeBytes": row[3],
    }
    item["kind"], item["format"] = attachment_type(str(row[2]))
    if include_path:
        item["relativePath"] = row[4]
        item["originalName"] = row[5]
    else:
        item["originalName"] = row[4]
    return item
