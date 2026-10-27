import json
import tempfile
import unittest
import uuid
from pathlib import Path

from mlx_studio_runtime.adapters.persistence.audio_repository import migrate_audio
from mlx_studio_runtime.adapters.persistence.model_migrations import (
    migrate_model_catalog,
)
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)


class AttachmentMigrationTests(unittest.TestCase):
    def legacy_database(self, path):
        database = SQLiteDatabase(path)
        migrate_audio(database)
        migrate_model_catalog(database)
        with database.transaction() as connection:
            connection.execute(
                "INSERT INTO conversations(id,title,created_at,updated_at) VALUES('c','Legacy',0,0)"
            )
            attachment_id = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO attachments VALUES(?,'hash','image/png',10,?,'old.png',0)",
                (attachment_id, f"attachments/{attachment_id}"),
            )
        return database, attachment_id

    def test_full_backfill_protects_jobs_and_artifacts_beyond_display_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.db"
            database, attachment_id = self.legacy_database(path)
            with database.transaction() as connection:
                for index in range(225):
                    request = json.dumps(
                        {"reference_ids": [attachment_id], "mask_id": attachment_id}
                    )
                    connection.execute(
                        "INSERT INTO jobs(id,kind,state,request_json,created_at,updated_at) VALUES(?,'image','succeeded',?,0,0)",
                        (f"job-{index}", request),
                    )
                    connection.execute(
                        "INSERT INTO artifacts(id,job_id,kind,relative_path,metadata_json,created_at) VALUES(?,NULL,'image',?,?,0)",
                        (f"art-{index}", f"images/{index}.png", request),
                    )
                connection.execute(
                    "INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES('m','c','user','legacy',0)"
                )
                connection.execute(
                    "INSERT INTO message_attachments VALUES('m',?,0)", (attachment_id,)
                )
            database.close()
            store = SQLiteRepositories(path)
            connection = store.database.connection
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM job_attachment_refs"
                ).fetchone()[0],
                450,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM artifact_attachment_refs"
                ).fetchone()[0],
                450,
            )
            self.assertEqual(
                store.conversations.get("c")["messages"][0]["attachments"][0]["id"],
                attachment_id,
            )
            self.assertTrue(path.with_suffix(".pre-attachments-v7.bak").is_file())
            self.assertTrue(
                connection.execute(
                    "SELECT 1 FROM settings WHERE key='attachment_reference_backfill_v7'"
                ).fetchone()
            )
            store.close()
            reopened = SQLiteRepositories(path)
            self.assertEqual(
                reopened.database.connection.execute(
                    "SELECT COUNT(*) FROM job_attachment_refs"
                ).fetchone()[0],
                450,
            )
            reopened.close()

    def test_invalid_legacy_json_records_diagnostics_and_blocks_gc_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.db"
            database, _ = self.legacy_database(path)
            with database.transaction() as connection:
                connection.execute(
                    "INSERT INTO jobs(id,kind,state,request_json,created_at,updated_at) VALUES('broken','chat','running','{bad',0,0)"
                )
            database.close()
            store = SQLiteRepositories(path)
            connection = store.database.connection
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM settings WHERE key='attachment_reference_backfill_v7'"
                ).fetchone()
            )
            diagnostic = connection.execute(
                "SELECT value_json FROM settings WHERE key='attachment_reference_backfill_diagnostics_v7'"
            ).fetchone()[0]
            self.assertIn("broken", diagnostic)
            self.assertEqual(
                connection.execute(
                    "SELECT state FROM jobs WHERE id='broken'"
                ).fetchone()[0],
                "failed",
            )
            store.close()
