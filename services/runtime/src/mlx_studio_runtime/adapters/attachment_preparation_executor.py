"""Bounded subprocess lifetime. Cancellation terminates the parser, not just its await."""

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from mlx_studio_runtime.adapters.memory_probe import read_memory
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class PreparationExecutor:
    def __init__(self, runtime_source: Path) -> None:
        self.runtime_source = runtime_source
        self.semaphore = asyncio.Semaphore(2)
        self.timeout_seconds = 30
        self.max_memory_bytes = 1024 * 1024 * 1024

    async def run(self, source: Path, staging: Path, format_name: str) -> dict[str, Any]:
        async with self.semaphore:
            process = await self._spawn()
            communication = asyncio.create_task(
                process.communicate(
                    json.dumps(
                        {
                            "source": str(source),
                            "staging": str(staging),
                            "format": format_name,
                        }
                    ).encode()
                )
            )
            try:
                async with asyncio.timeout(self.timeout_seconds):
                    while not communication.done():
                        await asyncio.wait({communication}, timeout=0.1)
                        memory = read_memory(process.pid).get("worker_memory_bytes")
                        if memory is not None and memory > self.max_memory_bytes:
                            raise RuntimeFault(
                                RuntimeErrorInfo(
                                    "ATTACHMENT_RESOURCE_LIMIT", "附件解析超过内存限制"
                                )
                            )
                    output, _ = await communication
                status = json.loads(output)
                if not status.get("ok") or process.returncode:
                    raise RuntimeFault(
                        RuntimeErrorInfo(
                            status.get("code", "ATTACHMENT_PARSE_FAILED"), "附件解析失败", True
                        )
                    )
                return json.loads((staging / "manifest.json").read_text())
            except TimeoutError as error:
                raise RuntimeFault(
                    RuntimeErrorInfo("ATTACHMENT_PARSE_TIMEOUT", "附件解析超时", True)
                ) from error
            finally:
                if process.returncode is None:
                    process.kill()
                await process.wait()
                await asyncio.gather(communication, return_exceptions=True)

    async def _spawn(self) -> asyncio.subprocess.Process:
        environment = os.environ.copy()
        for key in ("MLX_STUDIO_SESSION_TOKEN", "MLX_STUDIO_EXTERNAL_API_TOKEN"):
            environment.pop(key, None)
        environment["PYTHONPATH"] = str(self.runtime_source)
        arguments = (
            [sys.executable, "--prepare"]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-m", "mlx_studio_runtime.entrypoints.prepare"]
        )
        spawn = asyncio.create_task(
            asyncio.create_subprocess_exec(
                *arguments,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=environment,
            )
        )
        try:
            process = await asyncio.shield(spawn)
        except asyncio.CancelledError:
            process = await spawn
            if process.returncode is None:
                process.kill()
            await process.communicate()
            raise
        return process
