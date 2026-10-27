import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "runtime" / "src"))

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.models import fake_text_manifest, manifest_from_dict


class SQLiteRepositoriesTests(unittest.TestCase):
    def test_attachment_order_and_model_manifest_survive_reopen(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "app.db"
            store = SQLiteRepositories(database)
            store.conversations.save({"id": "conversation-1", "title": "Test"})
            for attachment_id in ("image-2", "image-1"):
                store.attachments.save(
                    {
                        "id": attachment_id,
                        "sha256": attachment_id,
                        "mimeType": "image/png",
                        "sizeBytes": 8,
                        "relativePath": f"attachments/{attachment_id}",
                        "originalName": f"{attachment_id}.png",
                    }
                )
            store.conversations.save_message(
                {
                    "id": "message-1",
                    "conversationId": "conversation-1",
                    "role": "user",
                    "content": "look",
                    "attachmentIds": ["image-2", "image-1"],
                }
            )
            manifest = fake_text_manifest()
            store.models.upsert(manifest.to_dict())
            store.close()

            reopened = SQLiteRepositories(database)
            conversation = reopened.conversations.get("conversation-1")
            self.assertEqual(
                [item["id"] for item in conversation["messages"][0]["attachments"]],
                ["image-2", "image-1"],
            )
            restored = manifest_from_dict(reopened.models.list()[0])
            self.assertEqual(restored.id, manifest.id)
            reopened.close()

    def test_message_write_rolls_back_when_attachment_relation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "app.db")
            store.conversations.save({"id": "conversation-1", "title": "Test"})
            from mlx_studio_runtime.domain.errors import RuntimeFault

            with self.assertRaises(RuntimeFault):
                store.conversations.save_message(
                    {
                        "id": "message-1",
                        "conversationId": "conversation-1",
                        "role": "user",
                        "content": "hello",
                        "attachmentIds": ["missing-attachment"],
                    }
                )
            store.conversations.save_message(
                {
                    "id": "message-2",
                    "conversationId": "conversation-1",
                    "role": "user",
                    "content": "after rollback",
                }
            )
            conversation = store.conversations.get("conversation-1")
            self.assertEqual(
                [message["id"] for message in conversation["messages"]],
                ["message-2"],
            )
            store.close()

    def test_attachment_file_is_removed_when_registration_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "data" / "app.db")
            store.attachments.save(
                {
                    "id": "duplicate",
                    "sha256": "first",
                    "mimeType": "image/png",
                    "sizeBytes": 8,
                    "relativePath": "attachments/first",
                    "originalName": "first.png",
                }
            )
            orphan = store.media_path / "attachments" / "orphan"
            orphan.parent.mkdir(parents=True, exist_ok=True)
            orphan.write_bytes(b"orphan")
            with self.assertRaises(sqlite3.IntegrityError):
                store.attachments.save(
                    {
                        "id": "duplicate",
                        "sha256": "second",
                        "mimeType": "image/png",
                        "sizeBytes": 6,
                        "relativePath": "attachments/orphan",
                        "originalName": "orphan.png",
                    }
                )
            self.assertFalse(orphan.exists())
            store.close()

    def test_recover_interrupted_jobs_marks_them_failed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "app.db")
            store.jobs.save({"id": "job-1", "kind": "chat", "state": "running"})
            self.assertEqual(store.jobs.recover_interrupted("RUNTIME_RESTARTED"), 1)
            job = store.jobs.list()[0]
            self.assertEqual(job["state"], "failed")
            self.assertEqual(job["errorCode"], "RUNTIME_RESTARTED")
            store.close()

    def test_assistant_replacement_is_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "app.db")
            store.conversations.save({"id": "conversation-1", "title": "Test"})
            store.conversations.save_message(
                {
                    "id": "user-1",
                    "turnId": "turn-1",
                    "conversationId": "conversation-1",
                    "role": "user",
                    "content": "question",
                }
            )
            store.conversations.save_message(
                {
                    "id": "assistant-old",
                    "turnId": "turn-1",
                    "conversationId": "conversation-1",
                    "role": "assistant",
                    "content": "old",
                }
            )
            store.conversations.save_message(
                {
                    "id": "assistant-new",
                    "turnId": "turn-1",
                    "conversationId": "conversation-1",
                    "role": "assistant",
                    "content": "new",
                },
                replace_message_id="assistant-old",
            )
            messages = store.conversations.get("conversation-1")["messages"]
            self.assertEqual(
                [item["content"] for item in messages], ["question", "new"]
            )
            store.close()


if __name__ == "__main__":
    unittest.main()
