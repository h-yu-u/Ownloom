"""Long data-owner RPCs retain their reply until completion or Host exit."""

import asyncio
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from mlx_studio_runtime.adapters.agent_host import AgentHost
from mlx_studio_runtime.domain.errors import RuntimeFault


class InputPipe:
    def __init__(self):
        self.sent = asyncio.Event()
        self.frame = None

    def write(self, data):
        self.frame = json.loads(data)
        self.sent.set()

    async def drain(self):
        pass


class AgentDataCompletionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.host = AgentHost(Path("/unused"))
        self.host.epoch = "test"
        self.host.start = AsyncMock()
        self.pipe = InputPipe()
        self.host.process = SimpleNamespace(stdin=self.pipe, returncode=0)
        self.timeout = asyncio.timeout

    def short_deadline(self, delay):
        return self.timeout(None if delay is None else 0.005)

    async def test_data_operations_keep_reply_past_control_rpc_deadline(self):
        for method, params, reply in (
            ("data.export", {}, {"directory": "/unused/export"}),
            (
                "data.restore.profile",
                {"identifier": "00000000-0000-0000-0000-000000000001"},
                {"imported": True},
            ),
        ):
            with (
                self.subTest(method=method),
                patch("asyncio.timeout", side_effect=self.short_deadline),
            ):
                self.pipe.sent.clear()
                request = asyncio.create_task(self.host.request(method, params))
                await self.pipe.sent.wait()
                await asyncio.sleep(0.025)
                retained = not request.done()
                pending = self.host.pending.get(self.pipe.frame["requestId"])
                if pending is not None and not pending.done():
                    pending.set_result(reply)
                result = (await asyncio.gather(request, return_exceptions=True))[0]
                self.assertTrue(
                    retained, "Node owner was abandoned before its completion reply"
                )
                self.assertEqual(result, reply)
                self.assertEqual(self.host.pending, {})

    async def test_ordinary_rpc_keeps_its_deadline(self):
        with (
            patch("asyncio.timeout", side_effect=self.short_deadline),
            self.assertRaises(RuntimeFault) as failure,
        ):
            await self.host.request("settings.get", {})
        self.assertEqual(failure.exception.info.code, "CODING_HOST_NOT_AVAILABLE")
        self.assertEqual(self.host.pending, {})

    async def test_host_exit_still_fails_pending_data_operation(self):
        reader = asyncio.StreamReader()
        reader.feed_eof()
        self.host.process.stdout = reader
        request = asyncio.create_task(self.host.request("data.export", {}))
        await self.pipe.sent.wait()
        await self.host._read()
        with self.assertRaises(RuntimeFault) as failure:
            await request
        self.assertEqual(failure.exception.info.code, "CODING_HOST_NOT_AVAILABLE")
        self.assertEqual(self.host.pending, {})
