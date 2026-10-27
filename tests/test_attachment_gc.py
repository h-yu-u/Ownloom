import tempfile
import unittest
import uuid
from pathlib import Path

from mlx_studio_runtime.adapters.attachment_gc import AttachmentGC
from mlx_studio_runtime.adapters.persistence.attachment_reference_repository import (
    AttachmentReferences,
)
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.errors import RuntimeFault


class AttachmentLifetimeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = SQLiteRepositories(Path(self.directory.name) / "app.db")
        self.id = str(uuid.uuid4())
        self.store.attachments.save(
            {
                "id": self.id,
                "sha256": "hash",
                "mimeType": "text/plain",
                "originalName": "file.txt",
                "sizeBytes": 4,
                "relativePath": f"attachments/{self.id}",
                "clientUploadId": "upload",
            }
        )
        self.original = self.store.media_path / "attachments" / self.id
        self.original.parent.mkdir(parents=True, exist_ok=True)
        self.original.write_text("data")
        self.gc = AttachmentGC(self.store.database)
        self.refs = AttachmentReferences(self.store.database)

    def tearDown(self):
        self.store.close()
        self.directory.cleanup()

    def test_draft_revisions_tombstones_and_late_upload_do_not_revive_removed_files(
        self,
    ):
        self.refs.update_draft("draft", 1, [], ["upload"])
        self.assertIsNone(self.gc.claim(self.id, -1))
        with self.assertRaises(RuntimeFault):
            self.refs.update_draft("draft", 1, [], [])
        self.refs.update_draft("draft", 2, [], [])
        self.refs.attach_upload("draft", 1, "upload", self.id)
        self.assertEqual(
            self.store.database.connection.execute(
                "SELECT COUNT(*) FROM attachment_draft_refs"
            ).fetchone()[0],
            0,
        )
        self.refs.close_draft("draft")
        with self.assertRaises(RuntimeFault):
            self.refs.update_draft("draft", 100, [self.id], [])
        token = self.gc.claim(self.id, -1)
        self.assertIsNotNone(token)
        with self.assertRaises(RuntimeFault):
            self.refs.update_draft("other", 1, [self.id], [])

    def test_recover_after_mark_and_after_move_is_idempotent(self):
        token = self.gc.claim(self.id, -1)
        self.assertIsNone(self.gc.claim(self.id, -1))
        self.gc.recover()
        self.assertFalse(self.original.exists())
        trash = self.store.media_path / ".trash" / f"attachment-{self.id}-{token}"
        self.assertEqual((trash / "original").read_text(), "data")
        self.gc.recover()
        self.assertFalse(self.gc.collect(self.id, token))
        self.gc.purge_trash(-1)
        self.assertFalse(trash.exists())

    def test_successful_job_reference_prevents_collection(self):
        self.store.jobs.save(
            {
                "id": "image-job",
                "kind": "image",
                "state": "succeeded",
                "request": {"reference_ids": [self.id]},
            }
        )
        self.assertIsNone(self.gc.claim(self.id, -1))
        self.assertTrue(self.original.exists())

    def test_message_reference_prevents_collection(self):
        self.store.conversations.save({"id": "conversation", "title": "Title"})
        self.store.conversations.save_message(
            {
                "id": "message",
                "conversationId": "conversation",
                "role": "user",
                "content": "text",
                "attachmentIds": [self.id],
            }
        )
        self.assertIsNone(self.gc.claim(self.id, -1))
