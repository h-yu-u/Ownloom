"""Explicit two-phase collection. No automatic collector is enabled by this release."""

import json
import shutil
import time
import uuid

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class AttachmentGC:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database
        database.connection.execute(
            "CREATE TABLE IF NOT EXISTS resource_protections "
            "(resource_id TEXT, owner TEXT, expires_at INTEGER, PRIMARY KEY(resource_id,owner))"
        )

    def claim(self, attachment_id: str, grace_seconds: int = 86400) -> str | None:
        uuid.UUID(attachment_id)
        with self.database.transaction() as connection:
            if not connection.execute(
                "SELECT 1 FROM settings WHERE "
                "key='attachment_reference_backfill_v7' AND value_json='true'"
            ).fetchone():
                return None
            row = connection.execute(
                "SELECT storage_state,created_at FROM attachments WHERE id=?", (attachment_id,)
            ).fetchone()
            if not row or row[0] != "active" or row[1] > time.time() - grace_seconds:
                return None
            if self._referenced(attachment_id):
                return None
            token = str(uuid.uuid4())
            connection.execute(
                "UPDATE attachments SET storage_state='deleting',gc_token=? WHERE id=?",
                (token, attachment_id),
            )
            return token

    def _referenced(self, attachment_id: str) -> bool:
        if self.database.connection.execute(
            "SELECT 1 FROM resource_protections WHERE resource_id=? AND expires_at>?",
            (attachment_id, int(time.time())),
        ).fetchone():
            return True
        for table in ("message_attachments", "job_attachment_refs", "artifact_attachment_refs"):
            if self.database.connection.execute(
                f"SELECT 1 FROM {table} WHERE attachment_id=? LIMIT 1", (attachment_id,)
            ).fetchone():
                return True
        if self.database.connection.execute(
            "SELECT 1 FROM attachment_draft_refs r JOIN attachment_drafts d ON d.id=r.draft_id "
            "WHERE r.attachment_id=? AND d.state='open' AND "
            "d.expires_at>?",
            (attachment_id, int(time.time())),
        ).fetchone():
            return True
        return bool(
            self.database.connection.execute(
                "SELECT 1 FROM attachment_preparations WHERE attachment_id=? AND "
                "state IN ('queued','preparing')",
                (attachment_id,),
            ).fetchone()
        )

    def collect(self, attachment_id: str, token: str) -> bool:
        uuid.UUID(attachment_id)
        uuid.UUID(token)
        row = self.database.connection.execute(
            "SELECT relative_path FROM attachments WHERE id=? AND "
            "storage_state='deleting' AND gc_token=?",
            (attachment_id, token),
        ).fetchone()
        if row is None:
            return False
        if self._referenced(attachment_id):
            return False
        metadata = self.database.connection.execute(
            "SELECT * FROM attachments WHERE id=?", (attachment_id,)
        ).fetchone()
        preparations = self.database.connection.execute(
            "SELECT * FROM attachment_preparations WHERE attachment_id=?", (attachment_id,)
        ).fetchall()
        root = self.database.media_path
        trash = root / ".trash" / f"attachment-{attachment_id}-{token}"
        trash.mkdir(parents=True, exist_ok=True)
        record = {
            "attachment": dict(metadata),
            "preparations": [dict(item) for item in preparations],
        }
        (trash / "record.json").write_text(json.dumps(record))
        source = root / row[0]
        if source.parent.resolve() != (root / "attachments").resolve() or source.is_symlink():
            return False
        if source.is_file():
            source.replace(trash / "original")
        for preparation in self.database.connection.execute(
            "SELECT id FROM attachment_preparations WHERE attachment_id=?", (attachment_id,)
        ).fetchall():
            uuid.UUID(preparation[0])
            directory = root / "attachment-derived" / preparation[0]
            if directory.is_dir() and not directory.is_symlink():
                directory.replace(trash / preparation[0])
        with self.database.transaction() as connection:
            connection.execute(
                "DELETE FROM attachments WHERE id=? AND storage_state='deleting' AND gc_token=?",
                (attachment_id, token),
            )
        return True

    def recover(self) -> None:
        for row in self.database.connection.execute(
            "SELECT id,gc_token FROM attachments WHERE storage_state='deleting'"
        ).fetchall():
            self.collect(row[0], row[1])

    def purge_trash(self, grace_seconds: int = 86400) -> None:
        directory = self.database.media_path / ".trash"
        if not directory.is_dir():
            return
        for path in directory.iterdir():
            if path.name.startswith("attachment-") and path.is_dir() and not path.is_symlink():
                try:
                    attachment_id, token = path.name[11:47], path.name[48:]
                    uuid.UUID(attachment_id)
                    uuid.UUID(token)
                except ValueError:
                    continue
                if self.database.connection.execute(
                    "SELECT 1 FROM attachments WHERE id=?", (attachment_id,)
                ).fetchone():
                    continue
                if path.stat().st_mtime < time.time() - grace_seconds:
                    shutil.rmtree(path)


def recover_derivatives(database: SQLiteDatabase) -> int:
    root = database.media_path / "attachment-derived"
    if not root.is_dir():
        return 0
    known = {
        row[0]
        for row in database.connection.execute(
            "SELECT id FROM attachment_preparations WHERE state IN ('ready','partial','needs_ocr')"
        )
    }
    recovered = 0
    for parent in (root, root / ".pending"):
        if not parent.is_dir():
            continue
        for path in parent.iterdir():
            if (
                not path.is_dir()
                or path.is_symlink()
                or path.name == ".pending"
                or path.name in known
            ):
                continue
            try:
                uuid.UUID(path.name[:36])
            except ValueError:
                continue
            target = (
                database.media_path
                / ".recovery"
                / "attachment-derived"
                / f"{path.name}-{uuid.uuid4()}"
            )
            target.parent.mkdir(parents=True, exist_ok=True)
            path.replace(target)
            recovered += 1
    return recovered
