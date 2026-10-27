import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.entrypoints.http.app import create_app


class ConversationManagementTests(unittest.TestCase):
    def test_rename_pin_unpin_validation_delete_and_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.db"
            app = create_app("test", path)
            with TestClient(app, headers={"Authorization": "Bearer test"}) as client:
                first = client.post(
                    "/internal/v1/conversations", json={"title": "First"}
                ).json()
                second = client.post(
                    "/internal/v1/conversations", json={"title": "Second"}
                ).json()
                root = "/internal/v1/conversations"
                self.assertEqual(client.get(root).json()[0]["id"], second["id"])
                pinned = client.patch(f"{root}/{first['id']}", json={"pinned": True})
                self.assertEqual(pinned.status_code, 200)
                self.assertTrue(pinned.json()["pinned"])
                self.assertEqual(client.get(root).json()[0]["id"], first["id"])
                renamed = client.patch(
                    f"{root}/{first['id']}", json={"title": "  新名称  "}
                )
                self.assertEqual(renamed.json()["title"], "新名称")
                self.assertTrue(renamed.json()["pinned"])
                for invalid in (
                    {},
                    {"title": "   "},
                    {"title": "x" * 161},
                    {"pinned": "true"},
                ):
                    self.assertEqual(
                        client.patch(f"{root}/{first['id']}", json=invalid).status_code,
                        422,
                    )
                self.assertEqual(
                    client.patch(f"{root}/missing", json={"pinned": True}).status_code,
                    404,
                )
            app = create_app("test", path)
            with TestClient(app, headers={"Authorization": "Bearer test"}) as client:
                restored = client.get(f"{root}/{first['id']}").json()
                self.assertTrue(restored["pinned"])
                self.assertEqual(restored["title"], "新名称")
                self.assertFalse(
                    client.patch(
                        f"{root}/{first['id']}", json={"pinned": False}
                    ).json()["pinned"]
                )
                self.assertEqual(
                    client.delete(f"{root}/{first['id']}").status_code, 200
                )
                self.assertEqual(
                    [item["id"] for item in client.get(root).json()], [second["id"]]
                )
                self.assertEqual(client.get(f"{root}/{first['id']}").status_code, 404)

    def test_old_database_migrates_without_losing_conversations_or_messages(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.db"
            connection = sqlite3.connect(path)
            connection.execute(
                'CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, model_id TEXT, parameters_json TEXT NOT NULL DEFAULT "{}", created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'
            )
            connection.execute(
                'INSERT INTO conversations VALUES ("old", "旧对话", NULL, "{}", 1, 2)'
            )
            connection.execute(
                "CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL "
                "REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, "
                "content TEXT NOT NULL, model_snapshot_json TEXT, "
                "parameters_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL)"
            )
            connection.execute(
                "INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("message", "old", "user", "保留消息", None, "{}", 1),
            )
            connection.commit()
            connection.close()
            store = SQLiteRepositories(path)
            self.assertFalse(store.conversations.get("old")["pinned"])
            self.assertEqual(
                store.conversations.get("old")["messages"][0]["content"], "保留消息"
            )
            store.conversations.save({"id": "new", "title": "最近对话"})
            self.assertTrue(store.conversations.update_metadata("old", None, True))
            self.assertEqual(store.conversations.list()[0]["id"], "old")
            self.assertEqual(store.conversations.get("old")["updatedAt"], 2)
            store.close()
            store = SQLiteRepositories(path)
            item = store.conversations.get("old")
            self.assertEqual(item["title"], "旧对话")
            self.assertTrue(item["pinned"])
            self.assertEqual(item["messages"][0]["content"], "保留消息")
            self.assertTrue(store.conversations.update_metadata("old", None, False))
            self.assertFalse(store.conversations.get("old")["pinned"])
            self.assertEqual(store.conversations.list()[0]["id"], "new")
            store.close()
