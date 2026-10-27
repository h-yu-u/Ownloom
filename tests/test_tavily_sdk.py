"""Exercise the real upstream SDK through a bounded mock HTTP transport."""

import asyncio
import gzip
import json
import unittest
from datetime import datetime
from unittest.mock import patch

import httpx
from mlx_studio_runtime.adapters.web.bounded_transport import BoundedTransport
from mlx_studio_runtime.adapters.web.tavily import Tavily
from mlx_studio_runtime.domain.errors import RuntimeFault
from mlx_studio_runtime.domain.web import WebConfig

NOW = datetime.fromisoformat("2026-10-27T21:29:00+08:00")
CONFIG = WebConfig("id", 1, "tavily", "https://search.example.com/tavily", "ref")
QUESTION = "看下今天ETH被AI模型证伪的信息，总结一下"


def record_responses(responses, requests):
    pending = iter(responses)

    def respond(request):
        requests.append(request)
        return next(pending)

    return respond


class TavilySDKTests(unittest.IsolatedAsyncioTestCase):
    def transport(self, handler):
        return patch(
            "mlx_studio_runtime.adapters.web.tavily.BoundedTransport",
            side_effect=lambda: BoundedTransport(httpx.MockTransport(handler)),
        )

    async def test_original_question_uses_sdk_and_preserves_custom_base_path(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "title": "Research announcement",
                            "url": "https://example.com/report",
                            "content": "Exponential Time Hypothesis",
                            "published_date": "2026-10-26",
                        }
                    ]
                },
            )

        with (
            self.transport(respond),
            patch("mlx_studio_runtime.adapters.web.tavily.datetime") as clock,
        ):
            clock.now.return_value = NOW
            hits = await Tavily().search(QUESTION, CONFIG, "test-key")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].published_at, "2026-10-26")
        self.assertEqual(
            str(requests[0].url), "https://search.example.com/tavily/search"
        )
        self.assertEqual(requests[0].headers["authorization"], "Bearer test-key")
        self.assertEqual(requests[0].headers["x-client-source"], "tavily-python")
        body = json.loads(requests[0].content)
        self.assertEqual(body["query"], QUESTION)
        self.assertEqual(body["time_range"], "day")
        self.assertEqual(body["search_depth"], "advanced")
        self.assertNotIn("filter_by_published_date", body)
        self.assertFalse(body["include_answer"])

    async def test_empty_or_stale_date_results_retry_without_range_once(self):
        for first_results in [
            [],
            [
                {
                    "title": "2025/07/27 old report",
                    "url": "https://example.com/old",
                    "content": "old",
                    "published_date": "2025-07-27",
                }
            ],
            [{"title": "Private", "url": "http://127.0.0.1/", "content": "private"}],
        ]:
            requests = []

            respond = record_responses(
                [
                    httpx.Response(200, json={"results": first_results}),
                    httpx.Response(
                        200,
                        json={
                            "results": [
                                {
                                    "title": "Announcement",
                                    "url": "https://example.com/new",
                                    "content": "new",
                                }
                            ]
                        },
                    ),
                ],
                requests,
            )

            with (
                self.transport(respond),
                patch("mlx_studio_runtime.adapters.web.tavily.datetime") as clock,
            ):
                clock.now.return_value = NOW
                hits = await Tavily().search(QUESTION, CONFIG, "test-key")
            self.assertEqual(len(requests), 2)
            self.assertEqual(hits[0].title, "Announcement")
            bodies = [json.loads(request.content) for request in requests]
            self.assertEqual(bodies[0]["time_range"], "day")
            self.assertNotIn("time_range", bodies[1])
            self.assertEqual(bodies[1]["query"], QUESTION)

    async def test_empty_results_are_bounded_to_two_calls(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"results": []})

        with self.transport(respond):
            self.assertEqual(await Tavily().search(QUESTION, CONFIG, "test"), [])
        self.assertEqual(len(requests), 2)

    async def test_sdk_extract_keeps_only_requested_nonempty_pages(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(
                200,
                json={
                    "results": [
                        {"url": "https://example.com/a", "raw_content": "Actual page"},
                        {"url": "https://example.com/b", "raw_content": " "},
                        {
                            "url": "https://other.example.com",
                            "raw_content": "unrequested",
                        },
                    ],
                    "failed_results": [{"url": "https://example.com/b"}],
                },
            )

        with self.transport(respond):
            pages = await Tavily().read(
                ["https://example.com/a", "https://example.com/b"], CONFIG, "test"
            )
        self.assertEqual(
            [(page.url, page.text) for page in pages],
            [("https://example.com/a", "Actual page")],
        )
        self.assertEqual(requests[0].url.path, "/tavily/extract")
        self.assertEqual(json.loads(requests[0].content)["format"], "text")

    async def test_sdk_errors_are_sanitized_and_do_not_trigger_search_retries(self):
        for status, message in [(401, "凭据"), (429, "额度"), (500, "请求失败")]:
            requests = []

            respond = record_responses(
                [
                    httpx.Response(
                        status, json={"detail": {"error": "test-key upstream body"}}
                    ),
                ],
                requests,
            )

            with self.transport(respond), self.assertRaises(RuntimeFault) as error:
                await Tavily().search(QUESTION, CONFIG, "test-key")
            self.assertEqual(len(requests), 1)
            self.assertIn(message, error.exception.info.message)
            self.assertNotIn("test-key", str(error.exception.info))

    async def test_invalid_or_oversized_responses_fail_at_boundary(self):
        for body in [
            b"[]",
            b'{"results":null}',
            b"not json",
            b" " * (2 * 1024 * 1024 + 1),
        ]:
            with (
                self.transport(
                    lambda _, payload=body: httpx.Response(200, content=payload)
                ),
                self.assertRaises(RuntimeFault) as error,
            ):
                await Tavily().search("query", CONFIG, "test")
            self.assertEqual(error.exception.info.code, "WEB_SEARCH_FAILED")

    async def test_bounded_transport_handles_compressed_responses(self):
        raw = json.dumps({"results": []}).encode()
        with self.transport(
            lambda _: httpx.Response(
                200, content=gzip.compress(raw), headers={"content-encoding": "gzip"}
            )
        ):
            self.assertEqual(await Tavily().search("query", CONFIG, "test"), [])

    async def test_timeout_and_cancellation_are_preserved(self):
        def timeout(request):
            raise httpx.ReadTimeout("upstream", request=request)

        with self.transport(timeout), self.assertRaises(RuntimeFault) as error:
            await Tavily().search("query", CONFIG, "test")
        self.assertEqual(error.exception.info.code, "WEB_SEARCH_TIMEOUT")
        started = asyncio.Event()

        async def blocked(_):
            started.set()
            await asyncio.Event().wait()

        with self.transport(blocked):
            task = asyncio.create_task(Tavily().search(QUESTION, CONFIG, "test"))
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
