import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.errors import RuntimeFault
from runtime_fixtures import create_test_runtime

SOURCE = Path(__file__).parents[1] / "services/runtime/src"


class ChatAdmissionRaceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = SQLiteRepositories(Path(self.directory.name) / "app.db")
        self.service = create_test_runtime(self.store, SOURCE)
        self.conversation = await self.service.chat.create_conversation(
            "test", "builtin-fake-text"
        )
        self.entered, self.release = asyncio.Event(), asyncio.Event()
        self.calls = 0
        self.snapshot = {
            "schemaVersion": 1,
            "workspace": "chat",
            "mode": "analyze",
            "catalogRevision": 1,
            "policyEpoch": 1,
            "skills": [{"id": "test-skill", "revision": 1, "digest": "test"}],
            "servers": [],
            "tools": [],
            "snapshotDigest": "test",
        }
        self.service.coding.call = self.call

    async def asyncTearDown(self):
        self.release.set()
        await self.service.close()
        self.directory.cleanup()

    async def call(self, method, _params):
        if method == "extensions.resolve":
            self.calls += 1
            self.entered.set()
            await self.release.wait()
            return {"snapshot": self.snapshot}
        if method == "extensions.skills.inspect":
            return {"body": "Be concise."}
        if method == "extensions.check":
            return {"valid": True}
        raise AssertionError(method)

    def intent(self, text="one"):
        return {
            "content": text,
            "model_id": "builtin-fake-text",
            "max_tokens": 32,
            "temperature": 0,
            "attachment_ids": [],
            "web_search": {"enabled": False},
            "visual_selection": None,
            "operation": "send",
            "target_user": None,
            "source_context_job_id": None,
            "extension_selection": {"skillIds": ["test-skill"], "toolIds": []},
        }

    def admit(self, request="one", text="one", conversation=None):
        return self.service.chat.admission.admit(
            conversation or self.conversation["id"], self.intent(text), request
        )

    async def race(self, second_request="one", second_text="one"):
        first = asyncio.create_task(self.admit())
        await self.entered.wait()
        second = asyncio.create_task(self.admit(second_request, second_text))
        await asyncio.sleep(0)
        self.release.set()
        return await asyncio.gather(first, second, return_exceptions=True)

    async def test_concurrent_identical_retry_returns_the_original_job(self):
        first, second = await self.race()
        self.assertIsInstance(first, tuple)
        self.assertIsInstance(second, tuple)
        self.assertIsNone(second[0])
        self.assertEqual(second[1]["jobId"], first[0].id)
        self.assertEqual(len(self.store.jobs.list()), 1)
        self.assertEqual(len(self.service.extensions.text_jobs), 1)

    async def test_concurrent_different_intent_reports_conflict(self):
        _first, second = await self.race(second_text="different")
        self.assertIsInstance(second, RuntimeFault)
        self.assertEqual(second.info.code, "IDEMPOTENCY_CONFLICT")
        self.assertEqual(len(self.service.extensions.text_jobs), 1)

    async def test_concurrent_different_submission_reports_busy(self):
        _first, second = await self.race("two", "two")
        self.assertIsInstance(second, RuntimeFault)
        self.assertEqual(second.info.code, "CONVERSATION_BUSY")
        self.assertEqual(len(self.service.extensions.text_jobs), 1)

    async def test_failed_transaction_releases_binding_and_allows_retry(self):
        self.release.set()
        with (
            patch.object(
                self.service.chat.journal, "save", side_effect=OSError("disk")
            ),
            self.assertRaises(OSError),
        ):
            await self.admit()
        self.assertEqual(self.service.extensions.text_jobs, {})
        self.assertEqual(self.store.jobs.list(), [])
        self.assertEqual(
            self.store.conversations.get(self.conversation["id"])["messages"], []
        )
        job, _request = await self.admit()
        self.assertEqual(set(self.service.extensions.text_jobs), {job.id})

    async def test_waiting_for_one_conversation_does_not_block_another(self):
        other = await self.service.chat.create_conversation(
            "other", "builtin-fake-text"
        )
        first = asyncio.create_task(self.admit())
        await self.entered.wait()
        self.entered.clear()
        second = asyncio.create_task(self.admit(conversation=other["id"]))
        try:
            await asyncio.wait_for(self.entered.wait(), 1)
        finally:
            self.release.set()
            results = await asyncio.gather(first, second, return_exceptions=True)
        self.assertTrue(all(isinstance(result, tuple) for result in results))

    async def test_cancelled_admission_releases_its_conversation(self):
        pending = asyncio.create_task(self.admit())
        await self.entered.wait()
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertEqual(self.service.extensions.text_jobs, {})
        self.release.set()
        job, _request = await asyncio.wait_for(self.admit(), 1)
        self.assertEqual(set(self.service.extensions.text_jobs), {job.id})

    async def test_text_assistant_transaction_failure_releases_binding(self):
        self.release.set()
        request = {
            "submissionId": "assistant",
            "workspace": "image",
            "text": "a lake",
            "modelId": "builtin-fake-text",
            "selection": {"skillIds": ["test-skill"], "toolIds": []},
        }
        with (
            patch.object(
                self.service.text_assistant.attempts,
                "save",
                side_effect=OSError("disk"),
            ),
            self.assertRaises(OSError),
        ):
            await self.service.text_assistant.create(request)
        self.assertEqual(self.service.extensions.text_jobs, {})
        self.assertEqual(self.store.jobs.list(), [])
