import asyncio
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from mlx_studio_runtime import PROTOCOL_VERSION
from mlx_studio_runtime.adapters.worker_host import WorkerHost, WorkerProtocolError

RUNTIME_SOURCE = Path(__file__).parents[1] / "services/runtime/src"


class WorkerProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_command_failure_finishes_while_worker_remains_alive(self):
        host = WorkerHost(RUNTIME_SOURCE)
        await host.start()
        try:

            async def collect():
                return [
                    event
                    async for event in host.generate_image("job", {}, Path("unused"))
                ]

            with self.assertRaises(WorkerProtocolError):
                await asyncio.wait_for(collect(), timeout=0.5)
            self.assertIsNone(host.process.returncode)
        finally:
            await host.stop()

    async def test_invalid_generation_frames_are_rejected(self):
        frames = [
            b"not-json\n",
            b"[]\n",
            self.frame("generation.completed", {}),
            self.frame("generation.delta", {"job_id": "other"}),
            self.frame("generation.completed", {"job_id": "job"}, seq=2),
            self.frame("worker.protocol_error", {}),
            b"",  # EOF
        ]
        for frame in frames:
            with self.subTest(frame=frame):
                host = WorkerHost(RUNTIME_SOURCE)
                reader = asyncio.StreamReader()
                reader.feed_data(frame)
                reader.feed_eof()
                host.process = SimpleNamespace(stdout=reader)
                with self.assertRaises(WorkerProtocolError):
                    _ = [event async for event in host._events_until_terminal("job")]

    @staticmethod
    def frame(kind, payload, seq=1):
        return (
            json.dumps(
                {
                    "protocol_version": PROTOCOL_VERSION,
                    "seq": seq,
                    "type": kind,
                    "payload": payload,
                }
            )
            + "\n"
        ).encode()


class SupervisorExitTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_exits_when_supervisor_stdin_closes(self):
        from mlx_studio_runtime.domain.models import fake_text_manifest

        host = WorkerHost(RUNTIME_SOURCE)
        await host.load(fake_text_manifest().to_dict())
        process = host.process
        try:
            process.stdin.close()
            await asyncio.wait_for(process.wait(), timeout=2)
            self.assertEqual(process.returncode, 0)
        finally:
            await host.stop()
