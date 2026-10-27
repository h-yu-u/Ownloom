"""Worker-only image engine bridge and cooperative step cancellation."""

import os
import sys
import threading
import time
from collections.abc import Callable
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

from mlx_studio_runtime.adapters.image_engines.fake_image import write_fake_png
from mlx_studio_runtime.domain.image_generation import ImageParameters


class WorkerImageEngine:
    def __init__(self, engine: str, model_path: str) -> None:
        self.engine = engine
        self.adapter: Any = None
        if engine != "fake":
            from mlx_studio_runtime.adapters.image_engines.mflux_image import MfluxImageEngine

            if engine != "mflux":
                raise ValueError("IMAGE_MODEL_NOT_SUPPORTED")
            with redirect_stdout(sys.stderr):
                self.adapter = MfluxImageEngine(model_path)

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
            values = dict(payload["parameters"])
            input_files = values.pop("input_files", {})
            parameters = ImageParameters(**values)
            output = self._output_path(str(payload["output_path"]))
            emit("generation.started", {"job_id": job_id})

            def progress(step: int) -> None:
                if cancel.is_set() or shutdown.is_set():
                    raise InterruptedError("IMAGE_CANCELLED")
                emit("image.progress", {"job_id": job_id, "step": step, "steps": parameters.steps})

            if self.engine == "fake":
                for step in range(1, parameters.steps + 1):
                    time.sleep(0.05)
                    progress(step)
                write_fake_png(output, parameters.width, parameters.height, parameters.seed)
            else:
                with redirect_stdout(sys.stderr):
                    self.adapter.generate(
                        dict(parameters.to_dict(), **self._input_files(input_files)),
                        output,
                        progress,
                    )
            if cancel.is_set() or shutdown.is_set():
                raise InterruptedError("IMAGE_CANCELLED")
            emit("generation.completed", {"job_id": job_id})
        except Exception:  # Worker inference boundary; no prompts or upstream errors enter logs.
            if output:
                output.unlink(missing_ok=True)
            cancelled = cancel.is_set() or shutdown.is_set()
            emit(
                "generation.cancelled" if cancelled else "generation.failed",
                {
                    "job_id": job_id,
                    "error_code": "IMAGE_GENERATION_FAILED",
                },
            )

    @staticmethod
    def _input_files(value: object) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("IMAGE_REFERENCES_INVALID")
        paths = value.get("image_paths", [])
        mask = value.get("mask_path")
        if not isinstance(paths, list) or len(paths) > 10:
            raise ValueError("IMAGE_REFERENCES_INVALID")
        configured = os.getenv("MLX_STUDIO_IMAGE_OUTPUT_ROOT")
        if not configured:
            raise ValueError("IMAGE_OUTPUT_ROOT_MISSING")
        root = Path(configured).resolve().parent / "attachments"
        for path in [*paths, *([mask] if mask else [])]:
            if not isinstance(path, str) or Path(path).resolve().parent != root:
                raise ValueError("IMAGE_REFERENCE_PATH_INVALID")
            from PIL import Image

            with Image.open(path) as image:
                if image.width * image.height > 16_777_216:
                    raise ValueError("IMAGE_REFERENCE_TOO_LARGE")
                image.verify()
        return {"image_paths": paths, "mask_path": mask}

    @staticmethod
    def _output_path(value: str) -> Path:
        configured = os.getenv("MLX_STUDIO_IMAGE_OUTPUT_ROOT")
        if not configured:
            raise ValueError("IMAGE_OUTPUT_ROOT_MISSING")
        root = Path(configured).resolve()
        path = Path(value).resolve()
        if path.parent != root / ".pending" or path.suffix != ".png":
            raise ValueError("IMAGE_PATH_INVALID")
        return path
