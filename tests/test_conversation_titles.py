import sqlite3
import tempfile
import unittest
from pathlib import Path

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.conversation_title import input_title


class ConversationTitleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "app.db"
        self.store = SQLiteRepositories(self.path)
        self.store.conversations.save({"id": "chat", "title": "新对话"})

    def tearDown(self) -> None:
        self.store.close()
        self.directory.cleanup()

    def message(self, identifier: str, content: str, role: str = "user") -> None:
        self.store.conversations.save_message(
            {
                "id": identifier,
                "conversationId": "chat",
                "role": role,
                "content": content,
            }
        )

    def test_titles_use_seven_unicode_characters_and_normalize_whitespace(self) -> None:
        for content, expected in (
            ("帮我搭建一个图书馆系统", "帮我搭建一个图"),
            ("  今日\n热点  ", "今日 热点"),
            ("🧑你好世界今天热点", "🧑你好世界今天"),
            ("你好", "你好"),
            ("  \n\t", ""),
        ):
            with self.subTest(content=content):
                self.assertEqual(input_title(content), expected)

    def test_first_nonempty_user_message_names_the_conversation_once(self) -> None:
        self.message("assistant", "助手内容", "assistant")
        self.message("empty", " \n\t")
        self.assertEqual(self.store.conversations.get("chat")["title"], "新对话")
        self.store.conversations.update_metadata("chat", None, True)
        self.message("first", "帮我搭建一个图书馆系统")
        self.message("next", "之后的问题不修改标题")
        self.assertEqual(self.store.conversations.list()[0]["title"], "帮我搭建一个图")
        self.assertTrue(self.store.conversations.get("chat")["pinned"])
        self.store.close()
        self.store = SQLiteRepositories(self.path)
        self.assertEqual(
            self.store.conversations.get("chat")["title"], "帮我搭建一个图"
        )

    def test_manual_names_are_preserved_even_when_equal_to_the_placeholder(
        self,
    ) -> None:
        for name in ("我的计划", "新对话"):
            with self.subTest(name=name):
                self.store.conversations.rename("chat", name)
                self.message(name, "帮我搭建一个图书馆系统")
                self.assertEqual(self.store.conversations.get("chat")["title"], name)

    def test_automatic_title_equal_to_placeholder_is_still_frozen(self) -> None:
        self.message("first", "新对话")
        self.message("next", "之后的问题不修改标题")
        self.assertEqual(self.store.conversations.get("chat")["title"], "新对话")

    def test_legacy_titles_are_backfilled_without_changing_order_or_custom_names(
        self,
    ) -> None:
        self.store.conversations.save({"id": "custom", "title": "保留自定义标题"})
        with self.store.database.transaction() as connection:
            for identifier in ("chat", "custom"):
                connection.execute(
                    "INSERT INTO messages(id,conversation_id,role,content,created_at) "
                    "VALUES(?,?,'user',?,1)",
                    (identifier, identifier, "帮我搭建一个图书馆系统"),
                )
        previous = self.store.conversations.list()
        self.store.close()
        self.store = SQLiteRepositories(self.path)
        items = self.store.conversations.list()
        self.assertEqual(
            [item["id"] for item in items], [item["id"] for item in previous]
        )
        self.assertEqual(
            [item["updatedAt"] for item in items],
            [item["updatedAt"] for item in previous],
        )
        self.assertEqual(
            self.store.conversations.get("chat")["title"], "帮我搭建一个图"
        )
        self.assertEqual(
            self.store.conversations.get("custom")["title"], "保留自定义标题"
        )

    def test_title_and_user_message_are_committed_atomically(self) -> None:
        self.store.database.connection.execute(
            "CREATE TRIGGER fail_title BEFORE UPDATE OF title ON conversations "
            "BEGIN SELECT RAISE(ABORT,'injected'); END"
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "injected"):
            self.message("first", "帮我搭建一个图书馆系统")
        conversation = self.store.conversations.get("chat")
        self.assertEqual(conversation["title"], "新对话")
        self.assertEqual(conversation["messages"], [])
