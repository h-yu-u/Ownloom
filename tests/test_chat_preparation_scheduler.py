import asyncio
import threading
import unittest
from unittest.mock import AsyncMock, patch

import test_web_retrieval as web_fixtures
from mlx_studio_runtime.adapters.worker_runtime.cancellation import WorkerCancellation


class PreparationSchedulerTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = web_fixtures.WebRetrievalTests.asyncSetUp
    asyncTearDown = web_fixtures.WebRetrievalTests.asyncTearDown
    send = web_fixtures.WebRetrievalTests.send
    finish = web_fixtures.WebRetrievalTests.finish

    async def test_search_failure_in_other_conversation_does_not_stop_active_generation(
        self,
    ):
        started, complete = asyncio.Event(), asyncio.Event()

        async def generate(job_id, *_args):
            started.set()
            yield {
                "type": "generation.delta",
                "payload": {"job_id": job_id, "text": "A"},
            }
            await complete.wait()
            yield {"type": "generation.completed", "payload": {"job_id": job_id}}

        with (
            patch.object(self.service.inference, "load", new=AsyncMock()),
            patch.object(self.service.inference, "generate", new=generate),
            patch.object(self.service.inference, "stop", new=AsyncMock()) as stop,
        ):
            first = await self.send("Local task")
            await started.wait()
            other = await self.service.chat.create_conversation(
                "Other", "builtin-fake-text"
            )
            self.provider.fail = True
            second = await self.service.chat.send_message(
                other["id"],
                "Search task",
                "builtin-fake-text",
                64,
                0,
                web_search=self.options,
            )
            self.assertEqual(
                (await self.finish(second))["errorCode"], "WEB_SEARCH_FAILED"
            )
            self.assertEqual(self.service.scheduler.active_job_id, first["jobId"])
            stop.assert_not_awaited()
            complete.set()
            self.assertEqual((await self.finish(first))["state"], "succeeded")

    async def test_cancel_waiting_for_model_never_loads_or_stops_other_lease(self):
        started, complete = asyncio.Event(), asyncio.Event()

        async def generate(job_id, *_args):
            started.set()
            await complete.wait()
            yield {"type": "generation.completed", "payload": {"job_id": job_id}}

        with (
            patch.object(self.service.inference, "load", new=AsyncMock()) as load,
            patch.object(self.service.inference, "generate", new=generate),
            patch.object(self.service.inference, "stop", new=AsyncMock()) as stop,
        ):
            first = await self.send("First")
            await started.wait()
            other = await self.service.chat.create_conversation(
                "Other", "builtin-fake-text"
            )
            second = await self.service.chat.send_message(
                other["id"], "Second", "builtin-fake-text", 64, 0
            )
            for _ in range(100):
                if (
                    self.service.queries.job(second["jobId"])["phase"]
                    == "waiting_model"
                ):
                    break
                await asyncio.sleep(0)
            self.assertEqual(
                (await self.service.scheduler.cancel(second["jobId"]))["state"],
                "cancelled",
            )
            self.assertEqual(load.await_count, 1)
            stop.assert_not_awaited()
            complete.set()
            await self.finish(first)

    async def test_cancel_after_worker_finished_does_not_stop_next_job(self):
        saving, release_save, next_generating, complete_next = (
            asyncio.Event() for _ in range(4)
        )
        finalizer = self.service.chat._finalize
        first_job = None

        async def finalize(job, *args):
            if job.id == first_job:
                saving.set()
                await release_save.wait()
            await finalizer(job, *args)

        async def generate(job_id, *_args):
            if job_id != first_job:
                next_generating.set()
                await complete_next.wait()
            yield {"type": "generation.completed", "payload": {"job_id": job_id}}

        with (
            patch.object(self.service.inference, "load", new=AsyncMock()),
            patch.object(self.service.inference, "generate", new=generate),
            patch.object(self.service.chat, "_finalize", new=finalize),
            patch.object(self.service.inference, "stop", new=AsyncMock()) as stop,
        ):
            first = await self.send("First")
            first_job = first["jobId"]
            await saving.wait()
            other = await self.service.chat.create_conversation(
                "Other", "builtin-fake-text"
            )
            second = await self.service.chat.send_message(
                other["id"], "Second", "builtin-fake-text", 64, 0
            )
            await next_generating.wait()
            await self.service.scheduler.cancel(first["jobId"])
            stop.assert_not_awaited()
            self.assertEqual(self.service.scheduler.active_job_id, second["jobId"])
            complete_next.set()
            self.assertEqual((await self.finish(second))["state"], "succeeded")
            self.assertEqual(
                len(
                    self.service.queries.conversation(self.conversation["id"])[
                        "messages"
                    ]
                ),
                1,
            )


class WorkerCancellationTests(unittest.TestCase):
    def test_pre_start_and_late_cancellation_are_scoped_to_job(self):
        signal = threading.Event()
        control = WorkerCancellation(signal)
        control.cancel("before-start")
        self.assertFalse(control.begin("before-start"))
        self.assertTrue(control.begin("A"))
        control.cancel("A")
        self.assertTrue(signal.is_set())
        control.finish("A")
        self.assertTrue(control.begin("B"))
        control.cancel("A")
        self.assertFalse(signal.is_set())
