"""Worker speech registry, bounded WAV writer and authenticated-command path boundaries."""

import os
import sys
import threading
import wave
from collections.abc import Callable, Iterator
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any, Protocol

from mlx_studio_runtime.adapters.audio_engines.fake_speech import FakeSpeechEngine
from mlx_studio_runtime.adapters.audio_files import (
    MAX_OUTPUT_BYTES,
    MAX_REFERENCE_BYTES,
    inspect_wav,
)
from mlx_studio_runtime.domain.speech import speech_error_code


class SpeechEngine(Protocol):
    def segments(
        self, parameters: dict[str, object], check: Callable[[], None]
    ) -> Iterator[tuple[int, bytes]]: ...
    def close(self) -> None: ...


class WorkerAudioEngine:
    def __init__(self, engine: str, model_path: str) -> None:
        self.adapter: SpeechEngine
        if engine == "fake":
            self.adapter = FakeSpeechEngine()
        elif engine == "mlx-audio":
            from mlx_studio_runtime.adapters.audio_engines.qwen3_tts import Qwen3TtsAdapter

            # Prohibit implicit resource downloads while holding the global inference lease.
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            with redirect_stdout(sys.stderr):
                self.adapter = Qwen3TtsAdapter(model_path)
        else:
            raise ValueError("SPEECH_ENGINE_UNSUPPORTED")

    def generate(
        self,
        payload: dict[str, Any],
        signals: tuple[threading.Event, threading.Event],
        emit: Callable[[str, dict[str, Any]], None],
    ) -> None:
        job_id = str(payload["job_id"])
        cancel, shutdown = signals
        output: Path | None = None
        try:
            parameters = dict(payload["parameters"])
            if set(parameters) - {
                "mode",
                "text",
                "language",
                "speaker",
                "reference_path",
                "reference_text",
            }:
                raise ValueError("SPEECH_PARAMETERS_UNSUPPORTED")
            root = self._root()
            output = Path(payload["output_path"])
            if (
                output.is_symlink()
                or output.resolve().parent != root / "staging"
                or output.suffix != ".wav"
            ):
                raise ValueError("AUDIO_PATH_INVALID")
            if parameters.get("mode") == "clone":
                reference = Path(str(parameters["reference_path"]))
                if reference.is_symlink() or reference.resolve().parent != root / "references":
                    raise ValueError("AUDIO_REFERENCE_PATH_INVALID")
                if reference.stat().st_size > MAX_REFERENCE_BYTES:
                    raise ValueError("AUDIO_TOO_LARGE")
                inspect_wav(reference.read_bytes())
            emit("generation.started", {"job_id": job_id})

            def check() -> None:
                if cancel.is_set() or shutdown.is_set():
                    raise InterruptedError("AUDIO_CANCELLED")

            self._write(parameters, output, check)
            check()
            emit("generation.completed", {"job_id": job_id})
        except Exception as error:  # Worker boundary; upstream text/audio never enters events.
            if output and output.resolve().parent == self._root() / "staging":
                output.unlink(missing_ok=True)
            code = speech_error_code(error)
            emit(
                "generation.cancelled"
                if cancel.is_set() or shutdown.is_set()
                else "generation.failed",
                {"job_id": job_id, "error_code": code},
            )

    def _write(
        self, parameters: dict[str, object], output: Path, check: Callable[[], None]
    ) -> None:
        total, rate = 0, None
        with wave.open(str(output), "wb") as audio, redirect_stdout(sys.stderr):
            audio.setnchannels(1)
            audio.setsampwidth(2)
            for sample_rate, pcm in self.adapter.segments(parameters, check):
                check()
                if (
                    not 8000 <= sample_rate <= 96000
                    or rate not in {None, sample_rate}
                    or len(pcm) % 2
                ):
                    raise ValueError("AUDIO_SAMPLE_RATE_INVALID")
                rate = sample_rate
                audio.setframerate(rate) if total == 0 else None
                total += len(pcm)
                if total > MAX_OUTPUT_BYTES - 44 or total > rate * 600 * 2:
                    raise ValueError("AUDIO_TOO_LARGE")
                audio.writeframesraw(pcm)
            if total == 0:
                raise ValueError("AUDIO_OUTPUT_EMPTY")

    @staticmethod
    def _root() -> Path:
        configured = os.environ.get("MLX_STUDIO_AUDIO_ROOT")
        if not configured:
            raise ValueError("AUDIO_OUTPUT_ROOT_MISSING")
        return Path(configured).resolve()

    def close(self) -> None:
        self.adapter.close()
