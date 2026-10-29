"""Fault injection for commit truth, bounded frames and observable streaming failures."""

import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from mlx_studio_runtime.adapters.worker_host import WorkerHost
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.jobs import JobEvent
from mlx_studio_runtime.entrypoints.http.provider_stream import stream_result
from mlx_studio_runtime.entrypoints.worker.main import Worker
from runtime_fixtures import create_test_app

RESULT = {
    "message": {"role": "assistant", "content": "answer"},
    "finish_reason": "stop",
    "input_tokens": 12,
    "generation_tokens": 6,
}


class InferenceReliabilityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.service = create_test_app(
            "test", Path(self.directory.name) / "app.db"
        ).state.service
        self.service.inference.load = AsyncMock()
        self.request = {
            "model": "builtin-fake-text",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [],
            "max_tokens": 512,
        }

    async def asyncTearDown(self):
        await self.service.close()
        self.directory.cleanup()

    async def run_events(self, kinds, cancel=False):
        service = self.service

        class Script:
            async def infer(self, job_id, _request):
                for kind in kinds:
                    if cancel and kind == "generation.completed":
                        await service.lifecycle.transition(
                            job_id, JobEvent.CANCEL_REQUESTED
                        )
                    yield {"type": kind, "payload": {**RESULT, "job_id": job_id}}

        self.service.provider_inference.inference = Script()
        return await self.service.provider_inference.complete(self.request)

    async def test_result_is_not_success_without_completion_or_after_failure(self):
        for kinds in [
            ["generation.result"],
            ["generation.result", "generation.failed"],
            ["generation.completed"],
            ["generation.result", "generation.completed", "generation.completed"],
        ]:
            with self.subTest(kinds=kinds), self.assertRaises(RuntimeFault):
                await self.run_events(kinds)
        self.assertTrue(
            all(job["state"] == "failed" for job in self.service.store.jobs.list())
        )
        self.assertEqual(
            self.service.store.database.connection.execute(
                "SELECT count(*) FROM inference_results"
            ).fetchone()[0],
            0,
        )

    async def test_database_failure_and_cancel_race_never_resolve_success(self):
        with (
            patch.object(
                self.service.store.jobs, "save_result", side_effect=OSError("disk")
            ),
            self.assertRaises(RuntimeFault),
        ):
            await self.run_events(["generation.result", "generation.completed"])
        with self.assertRaises(RuntimeFault):
            await self.run_events(
                ["generation.result", "generation.completed"], cancel=True
            )
        self.assertEqual(
            self.service.store.database.connection.execute(
                "SELECT count(*) FROM inference_results"
            ).fetchone()[0],
            0,
        )

    async def test_success_is_committed_and_usage_is_preserved(self):
        result = await self.run_events(["generation.result", "generation.completed"])
        row = self.service.store.database.connection.execute(
            "SELECT result_json FROM inference_results"
        ).fetchone()
        self.assertEqual(json.loads(row[0]), result)
        self.assertEqual(self.service.store.jobs.list()[0]["state"], "succeeded")

    async def test_partial_text_then_failure_emits_error_without_success_finish(self):
        queue = asyncio.Queue(2)
        release = asyncio.Event()

        async def generate():
            await queue.put({"type": "text.delta", "payload": {"text": "partial"}})
            await release.wait()
            raise RuntimeFault(
                RuntimeErrorInfo("INFERENCE_PROTOCOL_INCOMPLETE", "failed")
            )

        task = asyncio.create_task(generate())
        stream = stream_result(task, queue, {"id": "test"})
        await anext(stream)
        delta = await anext(stream)
        self.assertIn("partial", delta)
        self.assertFalse(task.done())
        release.set()
        rest = "".join([frame async for frame in stream])
        self.assertIn("event: error", rest)
        self.assertIn("[runtime:INFERENCE_PROTOCOL_INCOMPLETE]", rest)
        self.assertNotIn("[DONE]", rest)
        self.assertNotIn('"finish_reason": "stop"', rest)

    async def test_large_multibyte_escaped_result_round_trips_fragmented_worker_frames(
        self,
    ):
        worker = Worker()
        worker.protocol_output = io.StringIO()
        result = {
            **RESULT,
            "job_id": "large",
            "message": {"role": "assistant", "content": '中文\\"\n' * 20000},
        }
        worker.emit("generation.result", result)
        worker.emit("generation.completed", {"job_id": "large"})
        reader = asyncio.StreamReader(limit=16 * 1024 * 1024 + 1)
        reader.feed_data(worker.protocol_output.getvalue().encode())
        reader.feed_eof()
        host = WorkerHost(Path("."))
        host.process = SimpleNamespace(stdout=reader)
        events = [item async for item in host._events_until_terminal("large")]
        self.assertEqual(events[0]["payload"], result)
