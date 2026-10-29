"""NDJSON Worker used by the Supervisor. stdout is reserved for protocol frames."""

import json
import logging
import queue
import sys
import threading
import uuid
from typing import Any

from mlx_studio_runtime import PROTOCOL_VERSION
from mlx_studio_runtime.adapters.import_diagnostics import import_failure_chain
from mlx_studio_runtime.adapters.worker_runtime.cancellation import WorkerCancellation
from mlx_studio_runtime.adapters.worker_runtime.context import WorkerContext
from mlx_studio_runtime.adapters.worker_runtime.runtime import WorkerRuntime
from mlx_studio_runtime.domain.drafts import DraftLoadError
from mlx_studio_runtime.domain.mtp import MtpLoadError
from mlx_studio_runtime.domain.speech import speech_error_code
from mlx_studio_runtime.domain.worker_protocol import (
    LIMITS,
    MAX_FRAME_BYTES,
    MAX_RESULT_BYTES,
    text_parts,
)

logging.basicConfig(stream=sys.stderr, level=logging.INFO)
LOGGER = logging.getLogger("mlx_studio.worker")


class Worker:
    def __init__(self) -> None:
        self.commands: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=32)
        self.context = WorkerContext(self.emit)
        self.runtime = WorkerRuntime(self.context)
        self.cancel, self.shutdown = self.context.signals
        self.cancellation = WorkerCancellation(self.cancel)
        self.sequence = 0
        self.epoch = str(uuid.uuid4())
        self.attempt_id: str | None = None
        self.protocol_lock = threading.Lock()
        self.protocol_output = sys.stdout

    def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        if event_type == "generation.result":
            serialized = json.dumps(payload, ensure_ascii=False)
            if len(serialized.encode()) > MAX_RESULT_BYTES:
                raise ValueError("INFERENCE_RESULT_TOO_LARGE")
            if len(serialized.encode()) > 64 * 1024:
                for part in text_parts(serialized):
                    self.emit("generation.result.part", {"job_id": payload["job_id"], "text": part})
                self.emit("generation.result.end", {"job_id": payload["job_id"]})
                return
        with self.protocol_lock:
            self.sequence += 1
            frame = {
                "protocol_version": PROTOCOL_VERSION,
                "seq": self.sequence,
                "worker_epoch": self.epoch,
                "attempt_id": self.attempt_id,
                "item_id": str(payload.get("job_id", "worker")) + ":assistant",
                "type": event_type,
                "payload": payload,
            }
            serialized = json.dumps(frame, ensure_ascii=False, separators=(",", ":")) + "\n"
            if len(serialized.encode()) > MAX_FRAME_BYTES:
                raise ValueError("WORKER_FRAME_TOO_LARGE")
            self.protocol_output.write(serialized)
            self.protocol_output.flush()

    def read_commands(self) -> None:
        for line in sys.stdin:
            try:
                if len(line.encode()) > MAX_FRAME_BYTES:
                    raise ValueError("WORKER_FRAME_TOO_LARGE")
                command = json.loads(line)
                self._validate_command(command)
            except (json.JSONDecodeError, ValueError) as error:
                LOGGER.error("Invalid worker protocol frame: %s", error)
                self.emit("worker.protocol_error", {"message": str(error)})
                self.shutdown.set()
                return
            if command["type"] == "generation.cancel":
                self.cancellation.cancel(str(command.get("payload", {}).get("job_id", "")))
                continue
            if command["type"] == "worker.shutdown":
                self.shutdown.set()
                continue
            try:
                self.commands.put_nowait(command)
            except queue.Full:
                self.emit("worker.protocol_error", {"message": "WORKER_QUEUE_FULL"})
                self.shutdown.set()
                return
        # The Supervisor can exit without a shutdown command (for example after a crash).
        self.shutdown.set()

    @staticmethod
    def _validate_command(command: object) -> None:
        if not isinstance(command, dict):
            raise ValueError("command must be an object")
        if command.get("protocol_version") != PROTOCOL_VERSION:
            raise ValueError("protocol_version mismatch")
        if not isinstance(command.get("id"), str) or not isinstance(command.get("type"), str):
            raise ValueError("command id and type are required")
        if not isinstance(command.get("payload", {}), dict):
            raise ValueError("payload must be an object")

    def run(self) -> int:
        self.emit("worker.ready", {"worker_id": self.epoch, "limits": LIMITS})
        threading.Thread(target=self.read_commands, daemon=True).start()
        while not self.shutdown.is_set():
            try:
                command = self.commands.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                self.handle(command)
            except Exception as error:  # Worker process boundary.
                if isinstance(error, ImportError):
                    LOGGER.error("Worker import failed: %s", import_failure_chain(error))
                else:
                    LOGGER.error("Worker command failed: %s", type(error).__name__)
                self.emit(
                    "worker.command_failed",
                    {
                        "command_id": command["id"],
                        "job_id": command.get("payload", {}).get("job_id"),
                        "error": type(error).__name__,
                        "error_code": "DRAFT_LOAD_FAILED"
                        if isinstance(error, DraftLoadError)
                        else "MTP_LOAD_FAILED"
                        if isinstance(error, MtpLoadError)
                        else speech_error_code(error)
                        if command.get("payload", {}).get("manifest", {}).get("task")
                        == "text-to-speech"
                        else "WORKER_COMMAND_FAILED",
                    },
                )
        self.unload()
        self.emit("worker.stopped", {})
        return 0

    def handle(self, command: dict[str, Any]) -> None:
        self.attempt_id = command.get("id")
        if command["type"] in {"audio.start", "image.start", "inference.start", "generation.start"}:
            job_id = str(command.get("payload", {}).get("job_id", ""))
            if not self.cancellation.begin(job_id):
                self.emit("generation.cancelled", {"job_id": job_id})
                return
            try:
                self._handle(command)
            finally:
                self.cancellation.finish(job_id)
        else:
            self._handle(command)

    def _handle(self, command: dict[str, Any]) -> None:
        kind = command["type"]
        payload = command.get("payload", {})
        if kind == "worker.load":
            self.runtime.load(payload.get("manifest", {}))
        elif kind == "audio.start":
            self.runtime.generate_audio(payload)
        elif kind == "image.start":
            self.runtime.generate_image(payload)
        elif kind == "inference.start":
            self.runtime.infer(payload)
        elif kind == "generation.start":
            self.runtime.generate_text(payload)
        elif kind == "generation.cancel":
            return
        elif kind == "worker.shutdown":
            self.shutdown.set()
        elif kind == "worker.unload":
            self.unload()
        else:
            raise ValueError(f"unsupported command type: {kind}")

    def unload(self) -> None:
        self.runtime.unload()


def main() -> int:
    return Worker().run()


if __name__ == "__main__":
    raise SystemExit(main())
