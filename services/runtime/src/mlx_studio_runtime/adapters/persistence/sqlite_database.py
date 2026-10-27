"""SQLite connection, schema migration, and transaction boundary."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


class SQLiteDatabase:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self._migrate()

    @property
    def media_path(self) -> Path:
        data_directory = self.path.parent
        app_directory = data_directory.parent if data_directory.name == "data" else data_directory
        return app_directory / "media"

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        if self.connection.in_transaction:
            # Repository calls compose inside an application unit of work.
            yield self.connection
            return
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            yield self.connection
        except BaseException:
            self.connection.rollback()
            raise
        else:
            self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    def _migrate(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS models (
              id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, state TEXT NOT NULL,
              created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY, title TEXT NOT NULL, model_id TEXT,
              parameters_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              role TEXT NOT NULL, content TEXT NOT NULL, model_snapshot_json TEXT,
              parameters_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
              turn_id TEXT
            );
            CREATE INDEX IF NOT EXISTS messages_conversation_created
              ON messages(conversation_id, created_at);
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL,
              model_id TEXT, request_json TEXT NOT NULL, error_code TEXT,
              created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS image_submission_request
              ON jobs(json_extract(request_json, '$.clientRequestId'))
              WHERE kind='image' AND json_extract(request_json, '$.clientRequestId') IS NOT NULL;
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
              VALUES (3, CAST(strftime('%s','now') AS INTEGER));
            CREATE TABLE IF NOT EXISTS inference_results (
              job_id TEXT PRIMARY KEY REFERENCES jobs(id), result_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS artifacts (
              id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id), kind TEXT NOT NULL,
              relative_path TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attachments (
              id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, mime_type TEXT NOT NULL,
              size_bytes INTEGER NOT NULL, relative_path TEXT NOT NULL,
              original_name TEXT NOT NULL, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS message_attachments (
              message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
              attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
              position INTEGER NOT NULL, PRIMARY KEY(message_id, attachment_id)
            );
            CREATE TABLE IF NOT EXISTS runtime_sessions (
              id TEXT PRIMARY KEY, protocol_version INTEGER NOT NULL,
              started_at INTEGER NOT NULL, ended_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS chat_submissions (
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              request_id TEXT NOT NULL, digest TEXT NOT NULL, job_id TEXT NOT NULL,
              PRIMARY KEY(conversation_id, request_id)
            );
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
              VALUES (2, CAST(strftime('%s','now') AS INTEGER));
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
              VALUES (1, CAST(strftime('%s','now') AS INTEGER));
            """
        )
        columns = {
            row[1] for row in self.connection.execute("PRAGMA table_info(messages)").fetchall()
        }
        if "is_active" not in columns:
            self.connection.execute(
                "ALTER TABLE messages ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"
            )
        if "turn_id" not in columns:
            self.connection.execute("ALTER TABLE messages ADD COLUMN turn_id TEXT")
        artifact_columns = {
            row[1] for row in self.connection.execute("PRAGMA table_info(artifacts)")
        }
        if "recycled_at" not in artifact_columns:
            self.connection.execute("ALTER TABLE artifacts ADD COLUMN recycled_at INTEGER")
        conversation_columns = {
            row[1] for row in self.connection.execute("PRAGMA table_info(conversations)").fetchall()
        }
        if "pinned" not in conversation_columns:
            self.connection.execute(
                "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"
            )
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) "
            "VALUES (4, CAST(strftime('%s','now') AS INTEGER))"
        )
        self.connection.commit()
