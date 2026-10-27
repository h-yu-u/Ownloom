"""Version 7 is additive. Reference backfill has its own completion marker."""

import sqlite3
import time

from mlx_studio_runtime.adapters.persistence.attachment_reference_backfill import (
    backfill_references,
)
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase

SCHEMA = """
CREATE UNIQUE INDEX IF NOT EXISTS attachments_client_upload ON attachments(client_upload_id)
  WHERE client_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_attachments_attachment ON message_attachments(attachment_id);
CREATE TABLE IF NOT EXISTS attachment_preparations (
 id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
 source_sha256 TEXT NOT NULL, cache_key TEXT NOT NULL, attempt_no INTEGER NOT NULL,
 owner_token TEXT, revision INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('queued','preparing','ready','partial','needs_ocr',
 'failed','cancelled')), manifest_json TEXT NOT NULL DEFAULT '{}', error_code TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(attachment_id,cache_key,attempt_no), UNIQUE(id,attachment_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS attachment_one_preparation
 ON attachment_preparations(attachment_id,cache_key) WHERE state IN ('queued','preparing');
CREATE TABLE IF NOT EXISTS attachment_drafts (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'open'
 CHECK(state IN ('open','closed')), selection_json TEXT NOT NULL, selection_sha256 TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachment_draft_refs (
 draft_id TEXT NOT NULL REFERENCES attachment_drafts(id) ON DELETE CASCADE,
 attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
 PRIMARY KEY(draft_id,attachment_id)
);
CREATE INDEX IF NOT EXISTS attachment_drafts_expiry ON attachment_drafts(expires_at);
CREATE INDEX IF NOT EXISTS attachment_draft_refs_asset ON attachment_draft_refs(attachment_id);
CREATE TABLE IF NOT EXISTS job_attachment_refs (
 job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, usage TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0),
 attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
 preparation_id TEXT, origin_turn_id TEXT,
 PRIMARY KEY(job_id,usage,position), UNIQUE(job_id,usage,attachment_id),
 FOREIGN KEY(preparation_id,attachment_id) REFERENCES attachment_preparations(id,attachment_id)
 ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS job_attachments_asset ON job_attachment_refs(attachment_id);
CREATE TABLE IF NOT EXISTS artifact_attachment_refs (
 artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, usage TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0),
 attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
 PRIMARY KEY(artifact_id,usage,position), UNIQUE(artifact_id,usage,attachment_id)
);
CREATE INDEX IF NOT EXISTS artifact_attachments_asset ON artifact_attachment_refs(attachment_id);
CREATE TABLE IF NOT EXISTS chat_contexts (
 job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 turn_id TEXT NOT NULL, schema_version INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
 snapshot_sha256 TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_contexts_turn ON chat_contexts(conversation_id,turn_id,created_at);
CREATE TABLE IF NOT EXISTS web_search_profiles (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, current_revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS web_search_config_revisions (
 profile_id TEXT NOT NULL REFERENCES web_search_profiles(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, secret_ref TEXT,
 options_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
 PRIMARY KEY(profile_id,revision)
);
CREATE TABLE IF NOT EXISTS job_web_config_refs (
 job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL, revision INTEGER NOT NULL,
 FOREIGN KEY(profile_id,revision) REFERENCES web_search_config_revisions(profile_id,revision)
 ON DELETE RESTRICT
);
"""


def migrate_attachment_context(database: SQLiteDatabase) -> None:
    connection = database.connection
    if not connection.execute("SELECT 1 FROM schema_migrations WHERE version=7").fetchone():
        backup = database.path.with_suffix(".pre-attachments-v7.bak")
        if not backup.exists():
            with sqlite3.connect(backup) as destination:
                connection.backup(destination)
        with database.transaction():
            for table, name, definition in [
                ("attachments", "client_upload_id", "TEXT"),
                ("attachments", "storage_state", "TEXT NOT NULL DEFAULT 'active'"),
                ("attachments", "gc_token", "TEXT"),
                ("jobs", "phase", "TEXT NOT NULL DEFAULT 'accepted'"),
                ("jobs", "phase_details_json", "TEXT NOT NULL DEFAULT '{}'"),
                ("jobs", "projection_version", "INTEGER NOT NULL DEFAULT 0"),
                ("chat_submissions", "digest_version", "INTEGER NOT NULL DEFAULT 1"),
                ("conversations", "web_search_enabled", "INTEGER NOT NULL DEFAULT 0"),
            ]:
                columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
                if name not in columns:
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
            for statement in SCHEMA.split(";"):
                if statement.strip():
                    connection.execute(statement)
            connection.execute(
                "UPDATE jobs SET state='failed',error_code='RUNTIME_INTERRUPTED' "
                "WHERE state IN ('queued','preparing','running','cancelling')"
            )
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS chat_one_active_job_per_conversation "
                "ON jobs(json_extract(request_json,'$.conversationId')) WHERE kind='chat' "
                "AND json_valid(request_json) AND state IN "
                "('queued','preparing','running','cancelling')"
            )
            connection.execute("INSERT INTO schema_migrations VALUES(7,?)", (int(time.time()),))
    backfill_references(database)
