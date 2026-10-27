"""Explicit storage operations. Original metadata accompanies reversible collection."""

import hashlib
import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from mlx_studio_runtime.adapters.attachment_gc import AttachmentGC
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class StorageManagement:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database
        self.gc = AttachmentGC(database)
        columns = {row[1] for row in database.connection.execute("PRAGMA table_info(artifacts)")}
        if "recycled_at" not in columns:
            database.connection.execute("ALTER TABLE artifacts ADD COLUMN recycled_at INTEGER")
            database.connection.commit()

    def overview(self) -> dict[str, Any]:
        root = self.database.media_path
        sizes: dict[str, int] = {}
        for kind in ("attachments", "attachment-derived", "images", "audio", ".trash"):
            directory = root / kind
            sizes[kind] = (
                sum(
                    path.stat().st_size
                    for path in directory.rglob("*")
                    if path.is_file() and not path.is_symlink()
                )
                if directory.is_dir()
                else 0
            )
        return {
            "bytes": sum(sizes.values()),
            "categories": sizes,
            "automaticCleanup": False,
            "trash": self.trash(),
            "candidates": self.preview(),
        }

    def preview(self) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT id,size_bytes,original_name FROM attachments WHERE storage_state='active' "
            "AND created_at<? ORDER BY created_at LIMIT 200",
            (int(time.time()) - 86400,),
        ).fetchall()
        return [
            {"id": row[0], "bytes": row[1], "name": row[2]}
            for row in rows
            if not self.gc._referenced(row[0])
        ]

    def cleanup(self) -> dict[str, int]:
        collected, size = 0, 0
        for item in self.preview():
            token = self.gc.claim(item["id"])
            if token and self.gc.collect(item["id"], token):
                collected += 1
                size += item["bytes"]
        return {"collected": collected, "bytes": size}

    def trash(self) -> list[dict[str, str]]:
        root = self.database.media_path / ".trash"
        result = []
        if root.is_dir():
            for path in root.glob("attachment-*"):
                if not path.is_symlink() and (path / "record.json").is_file():
                    result.append({"id": path.name, "kind": "attachment"})
        rows = self.database.connection.execute(
            "SELECT id FROM artifacts WHERE recycled_at IS NOT NULL"
        )
        return result + [{"id": row[0], "kind": "image"} for row in rows]

    def recycle_image(self, identifier: str) -> None:
        uuid.UUID(identifier)
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE artifacts SET recycled_at=? WHERE id=? AND kind='image'",
                (int(time.time()), identifier),
            )

    def restore(self, identifier: str) -> None:
        if not identifier.startswith("attachment-"):
            uuid.UUID(identifier)
            with self.database.transaction() as connection:
                connection.execute(
                    "UPDATE artifacts SET recycled_at=NULL WHERE id=?", (identifier,)
                )
            return
        attachment_id, token = identifier[11:47], identifier[48:]
        uuid.UUID(attachment_id)
        uuid.UUID(token)
        root = self.database.media_path
        directory = root / ".trash" / identifier
        if directory.is_symlink() or not (directory / "record.json").is_file():
            raise RuntimeFault(RuntimeErrorInfo("TRASH_NOT_FOUND", "回收记录不存在"))
        record = json.loads((directory / "record.json").read_text())
        item = record["attachment"]
        target = root / item["relative_path"]
        if (
            item["id"] != attachment_id
            or target.parent.resolve() != (root / "attachments").resolve()
        ):
            raise RuntimeFault(RuntimeErrorInfo("TRASH_INVALID", "回收记录校验失败"))
        if target.exists():
            raise RuntimeFault(RuntimeErrorInfo("RESTORE_CONFLICT", "原路径已有文件"))
        original = directory / "original"
        with original.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                raise RuntimeFault(RuntimeErrorInfo("TRASH_INVALID", "回收文件校验失败"))
        item.update(storage_state="active", gc_token=None)
        moved: list[tuple[Path, Path]] = []
        try:
            with self.database.transaction() as connection:
                for table, rows in [
                    ("attachments", [item]),
                    ("attachment_preparations", record["preparations"]),
                ]:
                    allowed = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
                    for row in rows:
                        keys = [key for key in row if key in allowed]
                        connection.execute(
                            f"INSERT INTO {table}({','.join(keys)}) "
                            f"VALUES({','.join('?' for _ in keys)})",
                            [row[key] for key in keys],
                        )
                original.replace(target)
                moved.append((target, original))
                for preparation in record["preparations"]:
                    uuid.UUID(preparation["id"])
                    source = directory / preparation["id"]
                    destination = root / "attachment-derived" / preparation["id"]
                    if source.is_dir():
                        if destination.exists():
                            raise RuntimeFault(
                                RuntimeErrorInfo("RESTORE_CONFLICT", "资料版本已存在")
                            )
                        source.replace(destination)
                        moved.append((destination, source))
        except BaseException:
            for destination, source in reversed(moved):
                destination.replace(source)
            raise
        (directory / "record.json").unlink()
        directory.rmdir()

    def protect(self, identifier: str, owner: str, seconds: int) -> None:
        uuid.UUID(identifier)
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT storage_state FROM attachments WHERE id=?", (identifier,)
            ).fetchone()
            if not row or row[0] != "active":
                raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_NOT_FOUND", "资源已不可用"))
            if seconds == 0:
                connection.execute(
                    "DELETE FROM resource_protections WHERE resource_id=? AND owner=?",
                    (identifier, owner),
                )
            else:
                connection.execute(
                    "INSERT INTO resource_protections VALUES(?,?,?) "
                    "ON CONFLICT(resource_id,owner) DO UPDATE SET expires_at=excluded.expires_at",
                    (identifier, owner, int(time.time()) + seconds),
                )

    def backup(self, target: Path) -> None:
        with sqlite3.connect(target) as destination:
            self.database.connection.backup(destination)
