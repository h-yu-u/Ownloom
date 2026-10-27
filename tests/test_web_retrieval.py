import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.adapters.web.tavily import Tavily
from mlx_studio_runtime.adapters.web.url_policy import PublicResultPolicy
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.web import PageRead, SearchHit, WebConfig
from runtime_fixtures import create_test_runtime

SOURCE = Path(__file__).parents[1] / "services/runtime/src"


class Secrets:
    def __init__(self):
        self.resolves = 0
        self.values = {"ref-1": "private-key"}

    def resolve(self, reference):
        self.resolves += 1
        return self.values[reference]

    def put(self, value):
        reference = f"ref-{len(self.values) + 1}"
        self.values[reference] = value
        return reference

    def delete(self, reference):
        del self.values[reference]


class Provider:
    def __init__(self):
        self.queries = []
        self.reads = []
        self.barrier = None
        self.started = asyncio.Event()
        self.fail = False

    async def search(self, query, config, credential):
        self.queries.append((query, config.revision, credential))
        self.started.set()
        if self.barrier:
            await self.barrier.wait()
        if self.fail:
            raise RuntimeFault(RuntimeErrorInfo("WEB_SEARCH_FAILED", "failed", True))
        return [SearchHit("Source", "https://example.com/a", "Search summary")]

    async def read(self, urls, _config, _credential):
        self.reads.extend(urls)
        return [PageRead(url, "Actual extracted evidence") for url in urls]


class WebRetrievalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.service = create_test_runtime(
            SQLiteRepositories(Path(self.directory.name) / "app.db"), SOURCE
        )
        self.secrets = Secrets()
        self.provider = Provider()
        self.preparation = self.service.chat.preparation
        retrieval = self.preparation.retrieval
        retrieval.search = retrieval.reader = self.provider
        retrieval.secrets = self.service.web_settings.secrets = self.secrets
        retrieval.policy = type(
            "Allowed", (), {"allowed": AsyncMock(return_value=True)}
        )()
        self.config = self.preparation.configs.save(
            0, "https://api.tavily.com", "ref-1"
        )
        self.options = {
            "enabled": True,
            "config_id": self.config.id,
            "config_revision": 1,
        }
        self.conversation = await self.service.chat.create_conversation(
            "Test", "builtin-fake-text"
        )

    async def asyncTearDown(self):
        await self.service.close()
        self.directory.cleanup()

    async def send(self, text="Question", **options):
        return await self.service.chat.send_message(
            self.conversation["id"], text, "builtin-fake-text", 64, 0, **options
        )

    async def finish(self, result):
        task = self.service.scheduler.tasks.get(result["jobId"])
        if task:
            await task
        return self.service.queries.job(result["jobId"])

    async def test_off_does_not_resolve_credentials_search_or_read_urls(self):
        job = await self.finish(await self.send("Read https://example.com"))
        self.assertEqual(job["state"], "succeeded")
        self.assertEqual(self.provider.queries, [])
        self.assertEqual(self.provider.reads, [])
        self.assertEqual(self.secrets.resolves, 0)

    async def test_plain_chat_never_resolves_or_checks_extension_defaults(self):
        with patch.object(
            self.service.extensions.coding, "call", new_callable=AsyncMock
        ) as call:
            call.side_effect = AssertionError(
                "Plain chat must not load tools or skills"
            )
            job = await self.finish(await self.send("Hello"))
            self.assertEqual(job["state"], "succeeded")
            call.assert_not_awaited()

    async def test_transport_retry_after_config_change_returns_original_real_state(
        self,
    ):
        result = await self.send(client_request_id="request", web_search=self.options)
        original = await self.finish(result)
        self.preparation.configs.save(1, "https://api.tavily.com", "ref-2")
        duplicate = await self.send(
            client_request_id="request", web_search=self.options
        )
        self.assertEqual(duplicate["jobId"], result["jobId"])
        self.assertEqual(duplicate["state"], original["state"])
        self.assertEqual(len(self.provider.queries), 1)
        self.assertEqual(self.provider.queries[0][1], 1)
        with self.assertRaises(RuntimeFault) as error:
            await self.send(
                client_request_id="request",
                web_search={**self.options, "config_revision": 2},
            )
        self.assertEqual(error.exception.info.code, "IDEMPOTENCY_CONFLICT")

    async def test_reuse_copies_context_and_never_searches_again(self):
        original = await self.send(web_search=self.options)
        await self.finish(original)
        reused = await self.send(
            "",
            operation="reuse_context",
            target_user=original["userMessageId"],
            source_context_job_id=original["jobId"],
            client_request_id="reuse",
        )
        await self.finish(reused)
        database = self.service.store.database
        with database.transaction() as connection:
            connection.execute("DELETE FROM jobs WHERE id=?", (original["jobId"],))
        context = self.preparation.contexts.load(
            reused["jobId"], self.conversation["id"], original["turnId"]
        )
        self.assertIn("Actual extracted evidence", context["prompt"])
        self.assertEqual(len(self.provider.queries), 1)
        messages = self.service.queries.conversation(self.conversation["id"])[
            "messages"
        ]
        self.assertEqual([item["role"] for item in messages], ["user", "assistant"])
        self.assertNotIn("private-key", json.dumps(messages))

    async def test_failed_refresh_keeps_old_answer_and_local_only_uses_same_user(self):
        original = await self.send(web_search=self.options)
        await self.finish(original)
        before = self.service.queries.conversation(self.conversation["id"])["messages"][
            1
        ]
        self.provider.fail = True
        refreshed = await self.send(
            "",
            operation="refresh_web",
            target_user=original["userMessageId"],
            web_search=self.options,
            client_request_id="refresh",
        )
        self.assertEqual((await self.finish(refreshed))["state"], "failed")
        self.assertEqual(
            self.service.queries.conversation(self.conversation["id"])["messages"][1][
                "id"
            ],
            before["id"],
        )
        count = len(self.provider.queries)
        local = await self.send(
            "",
            operation="local_only",
            target_user=original["userMessageId"],
            client_request_id="local",
        )
        self.assertEqual((await self.finish(local))["state"], "succeeded")
        self.assertEqual(len(self.provider.queries), count)
        self.assertEqual(
            len(self.service.queries.conversation(self.conversation["id"])["messages"]),
            2,
        )

    async def test_cancel_search_does_not_touch_worker_or_start_page_reads(self):
        self.provider.barrier = asyncio.Event()
        result = await self.send(web_search=self.options)
        await self.provider.started.wait()
        with patch.object(
            self.service.inference, "stop", new_callable=AsyncMock
        ) as stop:
            cancelled = await self.service.scheduler.cancel(result["jobId"])
            self.assertEqual(cancelled["state"], "cancelled")
            stop.assert_not_awaited()
        self.assertEqual(self.provider.reads, [])
        self.assertIsNone(self.service.scheduler.active_job_id)

    async def test_busy_admission_rejects_before_new_user_or_search(self):
        self.provider.barrier = asyncio.Event()
        result = await self.send(web_search=self.options)
        await self.provider.started.wait()
        with self.assertRaises(RuntimeFault) as error:
            await self.send("second", web_search=self.options)
        self.assertEqual(error.exception.info.code, "CONVERSATION_BUSY")
        self.assertEqual(
            len(self.service.queries.conversation(self.conversation["id"])["messages"]),
            1,
        )
        self.assertEqual(len(self.provider.queries), 1)
        await self.service.scheduler.cancel(result["jobId"])

    async def test_secret_write_is_compensated_on_revision_conflict(self):
        before = self.secrets.values.copy()
        with self.assertRaises(RuntimeFault):
            await self.service.web_settings.save(0, "https://api.tavily.com", "new-key")
        self.assertEqual(self.secrets.values, before)
        public = json.dumps(self.service.web_settings.public())
        self.assertNotIn("private-key", public)
        self.assertNotIn("secret_ref", public)
        self.assertEqual(self.secrets.resolves, 0)

    async def test_tavily_200_with_failed_results_is_not_page_content(self):
        adapter = Tavily()
        adapter._call = AsyncMock(
            return_value={
                "results": [],
                "failed_results": [{"url": "https://example.com"}],
            }
        )
        self.assertEqual(
            await adapter.read(["https://example.com"], self.config, "test"), []
        )
        adapter._call = AsyncMock(
            return_value={
                "results": [
                    {"title": "Hit", "url": "https://example.com", "content": "Summary"}
                ]
            }
        )
        await adapter.search("question", self.config, "test")
        self.assertFalse(adapter._call.call_args.args[3]["include_answer"])

    async def test_url_policy_rejects_loopback_private_ports_and_non_http(self):
        policy = PublicResultPolicy()
        for url in [
            "http://127.0.0.1/",
            "http://192.168.0.1/",
            "file:///etc/passwd",
            "https://example.com:8080/",
            "https://key@example.com/",
        ]:
            self.assertFalse(await policy.allowed(url))

    async def test_proxy_dns_retains_search_snippets_without_fetching_blocked_addresses(
        self,
    ):
        retrieval = self.preparation.retrieval
        retrieval.policy = PublicResultPolicy()
        addresses = [(2, 1, 6, "", ("198.18.0.17", 443))]
        with patch.object(
            asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=addresses)
        ):
            result = await retrieval.retrieve("MLX", self.config, AsyncMock())
        self.assertEqual(len(result["sources"]), 1)
        self.assertEqual(result["sources"][0]["representation"], "snippet_only")
        self.assertEqual(result["sources"][0]["text"], "Search summary")
        self.assertTrue(result["partial"])
        self.assertEqual(result["readCount"], 0)
        self.assertEqual(self.provider.reads, [])

    async def test_private_literal_urls_cannot_become_snippet_sources(self):
        self.provider.search = AsyncMock(
            return_value=[
                SearchHit("Private", "http://127.0.0.1/", "not a public source")
            ]
        )
        with self.assertRaises(RuntimeFault):
            await self.preparation.retrieval.retrieve("MLX", self.config, AsyncMock())
        self.assertEqual(self.provider.reads, [])

    async def test_settings_test_reports_snippet_only_success(self):
        self.preparation.retrieval.policy = PublicResultPolicy()
        addresses = [(2, 1, 6, "", ("198.18.0.17", 443))]
        with patch.object(
            asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=addresses)
        ):
            result = await self.service.web_settings.test(
                self.config.id, self.config.revision
            )
        self.assertTrue(result["ok"])
        self.assertTrue(result["partial"])
        self.assertEqual(result["sourceCount"], 1)
        self.assertEqual(result["readCount"], 0)

    async def test_provider_redirect_cannot_forward_credentials(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(302, headers={"location": "https://example.com"})

        with (
            patch(
                "mlx_studio_runtime.adapters.web.tavily.BoundedTransport",
                return_value=httpx.MockTransport(respond),
            ),
            self.assertRaises(RuntimeFault),
        ):
            await Tavily().search(
                "question",
                WebConfig("id", 1, "tavily", "https://api.tavily.com", "ref"),
                "private-key",
            )
        self.assertEqual(
            [str(request.url) for request in requests],
            ["https://api.tavily.com/search"],
        )
