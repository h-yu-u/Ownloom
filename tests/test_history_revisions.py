import hashlib
import tempfile
import unittest
from pathlib import Path

from mlx_studio_runtime.adapters.persistence.chat_context_repository import (
    ChatContextRepository,
)
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.application.context_handoff import ContextHandoffs
from mlx_studio_runtime.domain.errors import RuntimeFault


class HistoryRevisionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = SQLiteRepositories(Path(self.directory.name) / "app.db")
        self.contexts = ChatContextRepository(self.store.database)

    def tearDown(self):
        self.store.close()
        self.directory.cleanup()

    def test_append_reuses_prefix_and_old_heads_survive_edit_or_delete(self):
        original = [{"role": "user", "content": f"message {i}"} for i in range(100)]
        head = self.contexts.freeze_history(original)
        extended = self.contexts.freeze_history(
            [*original, {"role": "assistant", "content": "answer"}]
        )
        count = self.store.database.connection.execute(
            "SELECT count(*) FROM context_revisions"
        ).fetchone()[0]
        self.assertEqual(count, 101)
        original[0]["content"] = "edited"
        self.contexts.freeze_history(original)
        self.assertEqual(self.contexts.history(head)[0]["content"], "message 0")
        self.assertEqual(self.contexts.history(extended)[-1]["content"], "answer")

    def test_sql_keyset_pages_cover_same_timestamp_history_once_with_bounded_first_page(
        self,
    ):
        self.store.conversations.save({"id": "conversation", "title": "large"})
        with self.store.database.transaction():
            for i in range(10001):
                self.store.conversations.save_message(
                    {
                        "id": f"m-{i}",
                        "conversationId": "conversation",
                        "role": "user",
                        "content": str(i),
                        "parameters": {"acceptedSnapshot": {"history": "private"}},
                    }
                )
        page = self.store.conversations.page("conversation", limit=50)
        self.assertEqual(len(page["messages"]), 50)
        self.assertNotIn("acceptedSnapshot", page["messages"][0]["parameters"])
        seen = set()
        while page:
            for item in page["messages"]:
                self.assertNotIn(item["id"], seen)
                seen.add(item["id"])
            if page["nextCursor"] is None:
                break
            page = self.store.conversations.page(
                "conversation", page["nextCursor"], 100
            )
        self.assertEqual(len(seen), 10001)

    def test_regeneration_keeps_canonical_body_for_queued_context_and_handoff(self):
        self.store.conversations.save({"id": "conversation", "title": "immutable"})
        self.store.conversations.save_message(
            {
                "id": "original",
                "conversationId": "conversation",
                "role": "assistant",
                "content": "early constraint",
            }
        )
        head = self.contexts.freeze_history(
            [
                {
                    "messageId": "original",
                    "role": "assistant",
                    "content": "early constraint",
                }
            ]
        )
        self.store.conversations.save_message(
            {
                "id": "replacement",
                "conversationId": "conversation",
                "role": "assistant",
                "content": "new answer",
            },
            replace_message_id="original",
        )
        self.assertEqual(self.contexts.history(head)[0]["content"], "early constraint")
        self.assertEqual(
            [
                item["id"]
                for item in self.store.conversations.page("conversation")["messages"]
            ],
            ["replacement"],
        )
        handoffs = ContextHandoffs(self.store.conversations, lambda *_: None)
        request = {
            "sourceConversationId": "conversation",
            "messages": [
                {
                    "id": "original",
                    "contentHash": hashlib.sha256(b"early constraint").hexdigest(),
                }
            ],
            "targetWorkspace": "chat",
        }
        frozen = handoffs.freeze(request, "test")
        self.assertFalse(frozen["permissionInheritance"])
        self.assertEqual(frozen["resolvedMessages"][0]["content"], "early constraint")
        request["messages"][0]["contentHash"] = "0" * 64
        with self.assertRaises(RuntimeFault):
            handoffs.freeze(request, "test")
