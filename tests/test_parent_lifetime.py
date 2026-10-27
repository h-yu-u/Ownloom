import asyncio
import os
import sys
import unittest


class ParentLifetimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_parent_pipe_eof_stops_its_async_owner(self) -> None:
        script = """
import asyncio
from mlx_studio_runtime.adapters.parent_lifetime import watch_parent_pipe
async def run():
    stopped = asyncio.Event()
    release = watch_parent_pipe(stopped.set)
    print('ready', flush=True)
    await stopped.wait()
    release()
asyncio.run(run())
"""
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            script,
            env={**os.environ, "MLX_STUDIO_PARENT_PIPE": "1"},
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            assert process.stdout is not None and process.stdin is not None
            frame = await asyncio.wait_for(process.stdout.readline(), timeout=5)
            self.assertEqual(frame.strip(), b"ready")
            process.stdin.close()
            await asyncio.wait_for(process.wait(), timeout=2)
            self.assertEqual(process.returncode, 0)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
