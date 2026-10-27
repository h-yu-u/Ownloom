"""Supervisor-side lifecycle and NDJSON transport for one Worker subprocess."""

import asyncio
import json
import os
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from mlx_studio_runtime import PROTOCOL_VERSION
from mlx_studio_runtime.domain.worker_protocol import LIMITS, MAX_FRAME_BYTES, MAX_RESULT_BYTES


class WorkerProtocolError(RuntimeError):
    def __init__(self, message: str, code: str = "WORKER_PROTOCOL_INVALID") -> None:
        super().__init__(message)
        self.code = code


class WorkerHost:
    def __init__(
        self,
        runtime_source: Path,
        image_output_root: Path | None = None,
        audio_root: Path | None = None,
    ) -> None:
        self.runtime_source = runtime_source
        self.image_output_root = image_output_root
        self.audio_root = audio_root
        self.process: asyncio.subprocess.Process | None = None
        self.write_lock = asyncio.Lock()
        self.stop_lock = asyncio.Lock()
        self.reader_task: asyncio.Task[None] | None = None
        self.epoch: str | None = None
        self.last_sequence = 0
        self.active_job_id: str | None = None

    @property
    def pid(self) -> int | None:
        if self.process is None or self.process.returncode is not None:
            return None
        return self.process.pid

    async def start(self) -> None:
        if self.process and self.process.returncode is None:
            return
        env = os.environ.copy()
        env.pop("MLX_STUDIO_SESSION_TOKEN", None)
        env.pop("MLX_STUDIO_EXTERNAL_API_TOKEN", None)
        if self.image_output_root is not None:
            env["MLX_STUDIO_IMAGE_OUTPUT_ROOT"] = str(self.image_output_root)
        if self.audio_root is not None:
            env["MLX_STUDIO_AUDIO_ROOT"] = str(self.audio_root)
        current = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{self.runtime_source}{os.pathsep}{current}".rstrip(os.pathsep)
        command = (
            [sys.executable, "--worker"]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-m", "mlx_studio_runtime.entrypoints.worker.main"]
        )
        self.process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            limit=MAX_FRAME_BYTES + 1,
        )
        self.last_sequence = 0
        self.epoch = None
        self.reader_task = asyncio.create_task(self._drain_stderr())
        event = await asyncio.wait_for(self._read_event(), timeout=10)
        if event["payload"].get("limits") != LIMITS:
            raise WorkerProtocolError("worker protocol limits mismatch")
        self.epoch = event.get("worker_epoch")
        if not self.epoch:
            raise WorkerProtocolError("worker epoch missing")
        if event["type"] != "worker.ready":
            raise WorkerProtocolError("worker failed readiness handshake")

    async def load(self, manifest: dict[str, Any]) -> None:
        await self.start()
        command_id = await self._send("worker.load", {"manifest": manifest})
        await self._wait_for("model.loaded", command_id)

    async def generate(
        self,
        job_id: str,
        prompt: str,
        max_tokens: int | None,
        temperature: float,
        image_paths: list[str] | None = None,
        messages: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        command_id = await self._send(
            "generation.start",
            {
                "job_id": job_id,
                "prompt": prompt,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "image_paths": image_paths or [],
                "messages": messages or [],
            },
        )
        async for event in self._events_until_terminal(job_id, command_id):
            yield event

    async def infer(self, job_id: str, request: dict[str, object]) -> AsyncIterator[dict[str, Any]]:
        command_id = await self._send("inference.start", {"job_id": job_id, **request})
        async for event in self._events_until_terminal(job_id, command_id):
            yield event

    async def generate_image(
        self,
        job_id: str,
        parameters: dict[str, object],
        output_path: Path,
    ) -> AsyncIterator[dict[str, Any]]:
        command_id = await self._send(
            "image.start",
            {
                "job_id": job_id,
                "parameters": parameters,
                "output_path": str(output_path),
            },
        )
        async for event in self._events_until_terminal(job_id, command_id):
            yield event

    async def cancel(self, job_id: str) -> None:
        if self.active_job_id == job_id:
            await self._send("generation.cancel", {"job_id": job_id})

    async def generate_audio(
        self, job_id: str, parameters: dict[str, object], output_path: Path
    ) -> AsyncIterator[dict[str, Any]]:
        command_id = await self._send(
            "audio.start",
            {"job_id": job_id, "parameters": parameters, "output_path": str(output_path)},
        )
        async for event in self._events_until_terminal(job_id, command_id):
            yield event

    async def stop(self) -> None:
        async with self.stop_lock:
            await self._stop()

    async def _stop(self) -> None:
        if self.process is None:
            return
        if self.process.returncode is None:
            try:
                await self._send("worker.shutdown", {})
                await asyncio.wait_for(self.process.wait(), timeout=3)
            except (TimeoutError, BrokenPipeError, ConnectionResetError, WorkerProtocolError):
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=2)
                except TimeoutError:
                    self.process.kill()
                    await asyncio.wait_for(self.process.wait(), timeout=2)
        if self.reader_task:
            await self.reader_task
        self.process = None

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    async def _send(self, command_type: str, payload: dict[str, Any]) -> str:
        if (
            self.process is None
            or self.process.stdin is None
            or self.process.returncode is not None
        ):
            raise WorkerProtocolError("worker is not running")
        frame = {
            "protocol_version": PROTOCOL_VERSION,
            "id": str(uuid.uuid4()),
            "type": command_type,
            "payload": payload,
        }
        async with self.write_lock:
            if command_type in {
                "generation.start",
                "inference.start",
                "image.start",
                "audio.start",
            }:
                self.active_job_id = str(payload["job_id"])
            serialized = (json.dumps(frame, ensure_ascii=False) + "\n").encode()
            if len(serialized) > MAX_FRAME_BYTES:
                raise WorkerProtocolError("worker command is too large", "WORKER_FRAME_TOO_LARGE")
            self.process.stdin.write(serialized)
            await self.process.stdin.drain()
        return frame["id"]

    async def _read_event(self) -> dict[str, Any]:
        if self.process is None or self.process.stdout is None:
            raise WorkerProtocolError("worker stdout is unavailable")
        line = await self.process.stdout.readline()
        if len(line) > MAX_FRAME_BYTES:
            raise WorkerProtocolError("worker frame too large", "WORKER_FRAME_TOO_LARGE")
        if not line:
            raise WorkerProtocolError("worker exited without an event")
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise WorkerProtocolError("worker emitted invalid JSON") from error
        if not isinstance(event, dict):
            raise WorkerProtocolError("worker event must be an object")
        if event.get("protocol_version") != PROTOCOL_VERSION:
            raise WorkerProtocolError("worker protocol version mismatch")
        if self.epoch is not None and event.get("worker_epoch") != self.epoch:
            raise WorkerProtocolError("stale worker epoch")
        if event.get("seq") != self.last_sequence + 1:
            raise WorkerProtocolError("worker event sequence is not monotonic")
        if not isinstance(event.get("payload"), dict) or not isinstance(event.get("type"), str):
            raise WorkerProtocolError("worker event schema is invalid")
        self.last_sequence = event["seq"]
        return event

    async def _wait_for(self, event_type: str, command_id: str) -> dict[str, Any]:
        while True:
            event = await asyncio.wait_for(self._read_event(), timeout=120)
            self._check_failure(event, command_id)
            if event.get("attempt_id") != command_id:
                raise WorkerProtocolError("stale worker attempt")
            if event["type"] == event_type:
                return event

    @staticmethod
    def _check_failure(event: dict[str, Any], command_id: str | None) -> None:
        if event["type"] == "worker.command_failed":
            if event["payload"].get("command_id") != command_id:
                raise WorkerProtocolError("worker failed an unexpected command")
            raise WorkerProtocolError(
                "worker command failed",
                str(event["payload"].get("error_code", "WORKER_COMMAND_FAILED")),
            )
        if event["type"] in {"worker.protocol_error", "worker.stopped"}:
            raise WorkerProtocolError("worker stopped or rejected the protocol")

    async def _events_until_terminal(
        self,
        job_id: str,
        command_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        terminal = {"generation.completed", "generation.cancelled", "generation.failed"}
        result_parts: list[str] = []
        result_bytes = 0
        while True:
            event = await self._read_event()
            self._check_failure(event, command_id)
            if command_id is not None and event.get("attempt_id") != command_id:
                raise WorkerProtocolError("stale worker attempt")
            payload = event["payload"]
            if payload.get("job_id") != job_id:
                raise WorkerProtocolError("Worker returned an event for another job")
            if event["type"] == "generation.result.part":
                part = str(payload["text"])
                result_bytes += len(part.encode())
                if result_bytes > MAX_RESULT_BYTES:
                    raise WorkerProtocolError("result too large", "INFERENCE_RESULT_TOO_LARGE")
                result_parts.append(part)
                continue
            if event["type"] == "generation.result.end":
                try:
                    event = {
                        **event,
                        "type": "generation.result",
                        "payload": json.loads("".join(result_parts)),
                    }
                except json.JSONDecodeError as error:
                    raise WorkerProtocolError("invalid result fragments") from error
                result_parts = []
            yield event
            if event["type"] in terminal:
                if self.active_job_id == job_id:
                    self.active_job_id = None
                return

    async def _drain_stderr(self) -> None:
        if self.process is None or self.process.stderr is None:
            return
        while line := await self.process.stderr.readline():
            text = line.decode(errors="replace").rstrip()
            if text:
                print(f"[worker] {text}", file=sys.stderr)
