"""Lazy fixed Node host, multiplexed NDJSON control and deterministic EOF cleanup."""

import asyncio
import json
import logging
import os
import re
import shutil
import signal
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from mlx_studio_runtime.adapters.data_profiles import profile_base
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.generated.coding_rpc import SCHEMA, RpcMethod
from mlx_studio_runtime.domain.rpc_validation import validate_rpc

LOGGER = logging.getLogger("mlx_studio.coding_host")


class AgentHost:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.process: asyncio.subprocess.Process | None = None
        self.reader: asyncio.Task[None] | None = None
        self.stderr: asyncio.Task[None] | None = None
        self.epoch = ""
        self.command_pids: set[int] = set()
        self.pending: dict[str, asyncio.Future[object]] = {}
        self.methods: dict[str, RpcMethod] = {}
        self.start_lock = asyncio.Lock()
        self.write_lock = asyncio.Lock()

    async def start(self) -> None:
        async with self.start_lock:
            if self.process is not None and self.process.returncode is None and self.epoch:
                return
            if self.process is not None:
                await self._stop()
            packaged = os.getenv("MLX_STUDIO_CODING_RESOURCES")
            if packaged:
                root = Path(packaged)
                node = str(root / "bin" / "node")
            elif getattr(sys, "frozen", False):
                raise RuntimeFault(
                    RuntimeErrorInfo("CODING_HOST_NOT_AVAILABLE", "Coding 资源未打包")
                )
            else:
                root = Path(__file__).parents[4] / "coding-agent"
                node = shutil.which("node") or ""
            entry = root / "dist" / "main.js"
            if not node or not entry.is_file():
                raise RuntimeFault(
                    RuntimeErrorInfo("CODING_HOST_NOT_AVAILABLE", "请先构建 Coding Host")
                )
            try:
                self.process = await asyncio.create_subprocess_exec(
                    node,
                    str(entry),
                    str(self.directory),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env={
                        "PATH": "/usr/bin:/bin",
                        "LANG": "en_US.UTF-8",
                        "HOME": str(Path.home()),
                        "PI_CODING_AGENT_DIR": str(self.directory / "pi"),
                        "MLX_STUDIO_PROFILE_ROOT": str(
                            profile_base(self.directory.parent / "app.db")
                        ),
                    },
                    limit=16 * 1024 * 1024,
                )
                self.stderr = asyncio.create_task(self._drain_stderr())
                assert self.process.stdout is not None
                line = await asyncio.wait_for(self.process.stdout.readline(), timeout=30)
                frame = json.loads(line)
                if (
                    frame.get("protocolVersion") != SCHEMA["protocolVersion"]
                    or frame.get("type") != "host.ready"
                    or not isinstance(frame.get("hostEpoch"), str)
                ):
                    raise ValueError("CODING_PROTOCOL_INVALID")
                self.epoch = frame["hostEpoch"]
                self.reader = asyncio.create_task(self._read())
            except (OSError, ValueError, TimeoutError) as error:
                await self._stop()
                raise RuntimeFault(
                    RuntimeErrorInfo("CODING_HOST_NOT_AVAILABLE", "Coding Host 启动失败", True)
                ) from error

    async def request(self, method: RpcMethod, params: dict[str, object]) -> Any:
        try:
            validate_rpc(method, "params", params)
        except ValueError as error:
            raise RuntimeFault(RuntimeErrorInfo(str(error), "Coding 请求无效")) from error
        started = time.monotonic()
        await self.start()
        request_id = str(uuid.uuid4())
        future: asyncio.Future[object] = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        self.methods[request_id] = method
        frame = {
            "protocolVersion": SCHEMA["protocolVersion"],
            "hostEpoch": self.epoch,
            "requestId": request_id,
            "method": method,
            "params": params,
        }
        try:
            assert self.process is not None and self.process.stdin is not None
            async with self.write_lock:
                self.process.stdin.write((json.dumps(frame, ensure_ascii=False) + "\n").encode())
                await self.process.stdin.drain()
            async with asyncio.timeout(1300 if method == "capabilities.verify" else 30):
                return await future
        except (BrokenPipeError, TimeoutError) as error:
            raise RuntimeFault(
                RuntimeErrorInfo("CODING_HOST_NOT_AVAILABLE", "Coding Host 失联", True)
            ) from error
        finally:
            self.pending.pop(request_id, None)
            self.methods.pop(request_id, None)
            LOGGER.debug(
                "Coding request settled",
                extra={
                    "component": "coding_host",
                    "operation": method,
                    "request_id": request_id,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                },
            )

    async def _read(self) -> None:
        try:
            assert self.process is not None and self.process.stdout is not None
            while line := await self.process.stdout.readline():
                frame = json.loads(line)
                if (
                    frame.get("protocolVersion") != SCHEMA["protocolVersion"]
                    or frame.get("hostEpoch") != self.epoch
                ):
                    raise ValueError("CODING_PROTOCOL_INVALID")
                if frame.get("type") == "command.process":
                    pid = frame.get("pid")
                    if (
                        not isinstance(pid, int)
                        or pid <= 1
                        or frame.get("state") not in {"start", "end"}
                    ):
                        raise ValueError("CODING_PROCESS_FRAME_INVALID")
                    if frame["state"] == "start":
                        self.command_pids.add(pid)
                    else:
                        self.command_pids.discard(pid)
                    continue
                future = self.pending.get(frame.get("requestId"))
                if future is None or future.done():
                    continue
                if isinstance(frame.get("error"), str):
                    if re.fullmatch(SCHEMA["errorPattern"], frame["error"]) is None:
                        raise ValueError("CODING_PROTOCOL_INVALID")
                    future.set_exception(
                        RuntimeFault(RuntimeErrorInfo(frame["error"], "Coding 操作未完成"))
                    )
                elif "result" in frame:
                    validate_rpc(self.methods[frame["requestId"]], "result", frame["result"])
                    future.set_result(frame["result"])
                else:
                    raise ValueError("CODING_PROTOCOL_INVALID")
        except (ValueError, OSError):
            LOGGER.warning(
                "Coding protocol/transport failure",
                extra={
                    "component": "coding_host",
                    "operation": "read",
                    "error_code": "CODING_PROTOCOL_INVALID",
                },
            )
        finally:
            self.epoch = ""
            for pid in self.command_pids:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass  # Already reaped or no longer owned; never signal an unrelated group.
            self.command_pids.clear()
            for future in tuple(self.pending.values()):
                if not future.done():
                    future.set_exception(
                        RuntimeFault(
                            RuntimeErrorInfo(
                                "CODING_HOST_NOT_AVAILABLE", "Coding Host 已退出", True
                            )
                        )
                    )
            if self.process is not None and self.process.returncode is None:
                self.process.terminate()

    async def _drain_stderr(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        discarded = 0
        while chunk := await self.process.stderr.read(8192):
            discarded += len(chunk)
        if discarded:
            LOGGER.debug(
                "Coding diagnostics suppressed",
                extra={
                    "component": "coding_host",
                    "operation": "stderr",
                    "discarded_bytes": discarded,
                },
            )

    async def _stop(self) -> None:
        if self.process is not None and self.process.returncode is None:
            if self.process.stdin:
                self.process.stdin.close()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=8)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()
        for task in (self.reader, self.stderr):
            if task:
                await asyncio.gather(task, return_exceptions=True)
        self.process = None
        self.epoch = ""

    async def close(self) -> None:
        await self._stop()
