import unittest

from mlx_studio_runtime.domain.attachments import (
    MAX_TOTAL_BYTES,
    validate_attachment_set,
)
from mlx_studio_runtime.domain.chat_context import build_context, select_blocks
from mlx_studio_runtime.domain.errors import RuntimeFault


class ChatContextTests(unittest.TestCase):
    def test_current_time_changes_only_the_uncached_tail_not_the_stable_history(self):
        history = [{"role": "user", "content": "remember JADE-47"}]
        first = build_context(
            "code?", history, [], [], 8192, 64, 0, "2026-10-28T10:00:00"
        )
        second = build_context(
            "code?", history, [], [], 8192, 64, 0, "2026-10-28T10:00:30"
        )
        self.assertEqual(first["messages"][:-1], second["messages"][:-1])
        self.assertEqual(first["prompt"], first["messages"][-1]["content"])
        self.assertNotEqual(first["cacheSuffix"], second["cacheSuffix"])
        self.assertEqual(
            second["messages"][-1]["content"], "code?" + second["cacheSuffix"]
        )
        self.assertEqual(history, [{"role": "user", "content": "remember JADE-47"}])

    def test_automatic_output_uses_remaining_window_without_reserving_it_before_sources(
        self,
    ):
        source = {
            "id": "w1",
            "kind": "web",
            "title": "Source",
            "url": "https://example.com",
            "representation": "snippet_only",
            "text": "Relevant evidence " * 100,
        }
        snapshot = build_context("Summarize", [], [], [source], 262144, None, 0)
        budget = snapshot["budget"]
        self.assertEqual(len(snapshot["sources"]), 1)
        self.assertGreater(budget["outputReserve"], 8192)
        self.assertEqual(
            budget["inputTokens"] + budget["outputReserve"] + budget["safetyReserve"],
            262144,
        )
        self.assertIn("Relevant evidence", snapshot["prompt"])
        small = build_context("Hello", [], [], [], 2048, None, 0)
        self.assertGreater(small["budget"]["outputReserve"], 0)
        self.assertLess(small["budget"]["outputReserve"], 2048)

    def test_long_summary_cannot_silently_become_top_k(self):
        blocks = [{"id": str(index), "text": "long " * 100} for index in range(10)]
        with self.assertRaises(RuntimeFault) as error:
            select_blocks(blocks, "请总结全文", 600)
        self.assertEqual(error.exception.info.code, "CONTEXT_BUDGET_EXCEEDED")

    def test_chinese_lexical_selection_reports_partial_coverage(self):
        blocks = [
            {"id": "a", "text": "经济增长" * 100},
            {"id": "b", "text": "人工智能" * 100},
        ]
        selected = select_blocks(blocks, "人工智能情况如何", 600)
        self.assertEqual([block["id"] for block in selected], ["b"])
        snapshot = build_context(
            "人工智能情况如何",
            [],
            [
                {
                    "id": "doc",
                    "preparationId": "prep",
                    "originalName": "report",
                    "coverage": {"complete": True},
                    "blocks": blocks,
                }
            ],
            [],
            2300,
            1000,
            0,
        )
        self.assertFalse(snapshot["sources"][0]["coverage"]["complete"])
        self.assertEqual(snapshot["sources"][0]["locations"][0]["blockId"], "b")

    def test_total_limits_are_independent_of_image_count_and_duplicates(self):
        validate_attachment_set([{"id": str(i), "sizeBytes": 1} for i in range(8)])
        for items in [
            [{"id": str(i), "sizeBytes": 1} for i in range(9)],
            [{"id": "a", "sizeBytes": MAX_TOTAL_BYTES + 1}],
            [{"id": "same", "sizeBytes": 1}] * 2,
        ]:
            with self.assertRaises(RuntimeFault):
                validate_attachment_set(items)
