"""Relative dates guide search without discarding useful recent or undated evidence."""

import unittest
from datetime import datetime
from unittest.mock import AsyncMock, Mock, patch

from mlx_studio_runtime.application.web_retrieval import WebRetrieval
from mlx_studio_runtime.domain.chat_context import build_context
from mlx_studio_runtime.domain.errors import RuntimeFault
from mlx_studio_runtime.domain.web import SearchHit, WebConfig
from mlx_studio_runtime.domain.web_freshness import freshness_window, rank_hits

NOW = datetime.fromisoformat("2026-10-27T21:29:00+08:00")


def hit(title, published_at=None):
    return SearchHit(title, f"https://example.com/{title}", "summary", published_at)


class FreshnessTests(unittest.TestCase):
    def test_today_uses_user_calendar_and_does_not_rewrite_historical_questions(self):
        window = freshness_window("GitHub 今日热点", NOW)
        self.assertEqual(window.label, "2026-10-27")
        for query in [
            "MLX Apple Silicon",
            "今日头条的公司简介",
            "2025/07/27 GitHub 今日热门项目",
        ]:
            self.assertIsNone(freshness_window(query, NOW))
        self.assertEqual(
            freshness_window("最新热点", NOW).label, "2026-10-21 至 2026-10-27"
        )

    def test_prioritizes_today_then_recent_then_undated_and_rejects_stale_or_future(
        self,
    ):
        hits = [
            hit("Unknown"),
            hit("Yesterday", "2026-10-26"),
            hit("Old", "2025-07-27"),
            hit("Today", "2026-10-27"),
            hit("Future", "2026-10-28"),
            hit("2025/07/27-GitHub", "2026-10-27"),
            hit("2026年10月27日热点"),
        ]
        selected = rank_hits(hits, freshness_window("今日热点", NOW), NOW)
        self.assertEqual(
            [item.title for item in selected],
            [
                "Today",
                "2026年10月27日热点",
                "Yesterday",
                "Unknown",
            ],
        )
        self.assertEqual(rank_hits(hits, None, NOW), hits)

    def test_publication_timestamps_are_converted_to_user_timezone(self):
        hits = [
            hit("LocalToday", "2026-10-26T18:00:00Z"),
            hit("LocalYesterday", "2026-10-26T15:59:00Z"),
            hit("RFC", "Mon, 26 Oct 2026 21:00:00 GMT"),
        ]
        selected = rank_hits(hits[::-1], freshness_window("today", NOW), NOW)
        self.assertEqual(
            [item.title for item in selected], ["RFC", "LocalToday", "LocalYesterday"]
        )

    def test_prompt_carries_clock_dates_and_qualifies_recent_undated_evidence(self):
        snapshot = build_context(
            "今日热点",
            [],
            [],
            [
                {
                    "id": "w1",
                    "kind": "web",
                    "title": "Report",
                    "url": "https://example.com",
                    "publishedAt": "2026-10-26",
                    "retrievedAt": NOW.isoformat(),
                    "representation": "snippet_only",
                    "text": "Report about a recent announcement",
                }
            ],
            8192,
            128,
            0,
            current_time=NOW.isoformat(),
        )
        system = snapshot["messages"][0]["content"]
        self.assertIn(NOW.isoformat(), system)
        self.assertIn("检索时间不是发布时间", system)
        self.assertIn("须标明实际日期", system)
        self.assertIn("无日期页面不能证明今日状态", system)
        self.assertIn("独立验证", system)
        self.assertIn("发布时间: 2026-10-26", snapshot["prompt"])
        self.assertIn(f"检索时间: {NOW.isoformat()}", snapshot["prompt"])


class TemporalRetrievalTests(unittest.IsolatedAsyncioTestCase):
    async def test_recent_and_undated_sources_reach_model_but_old_articles_do_not(self):
        search, reader, secrets, policy = AsyncMock(), AsyncMock(), Mock(), AsyncMock()
        search.search.return_value = [
            hit("2025/07/27-GitHub", "2025-07-27"),
            hit("Undated"),
            hit("Yesterday", "2026-10-26"),
            hit("Current", "2026-10-27"),
        ]
        secrets.resolve.return_value = "test"
        policy.allowed.return_value = True
        reader.read.return_value = []
        retrieval = WebRetrieval(search, reader, secrets, policy)
        config = WebConfig("id", 1, "tavily", "https://api.tavily.com", "ref")
        with patch("mlx_studio_runtime.application.web_retrieval.datetime") as clock:
            clock.now.return_value = NOW
            result = await retrieval.retrieve("今日热点", config, AsyncMock())
        self.assertEqual(
            [item["title"] for item in result["sources"]],
            [
                "Current",
                "Yesterday",
                "Undated",
            ],
        )
        self.assertEqual(result["sources"][1]["publishedAt"], "2026-10-26")
        self.assertIsNone(result["sources"][2]["publishedAt"])
        self.assertTrue(result["partial"])

    async def test_old_only_results_do_not_become_current_facts(self):
        search, reader, secrets, policy = AsyncMock(), AsyncMock(), Mock(), AsyncMock()
        search.search.return_value = [hit("2025/07/27-GitHub", "2025-07-27")]
        secrets.resolve.return_value = "test"
        retrieval = WebRetrieval(search, reader, secrets, policy)
        config = WebConfig("id", 1, "tavily", "https://api.tavily.com", "ref")
        with patch("mlx_studio_runtime.application.web_retrieval.datetime") as clock:
            clock.now.return_value = NOW
            with self.assertRaises(RuntimeFault) as error:
                await retrieval.retrieve("今日热点", config, AsyncMock())
        self.assertEqual(error.exception.info.code, "WEB_NO_RESULTS")
        reader.read.assert_not_awaited()
