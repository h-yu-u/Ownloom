"""Typed modality entry points; no driver reaches into another modality."""

from typing import Any, Literal

from mlx_studio_runtime.adapters.audio_engines.worker_audio import WorkerAudioEngine
from mlx_studio_runtime.adapters.image_engines.worker_image import WorkerImageEngine
from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.adapters.text_engines.structured import generate_structured
from mlx_studio_runtime.adapters.worker_runtime.context import WorkerContext


class TextDriver:
    kind: Literal["text"] = "text"

    def __init__(self, context: WorkerContext) -> None:
        self.context = context
        self.session = EngineSession(context=context)
        self.engine = "fake"

    def load(self, manifest: dict[str, Any]) -> None:
        self.engine = str(manifest["engine"])
        self.context.configure_device(self.engine)
        self.session.load({"manifest": manifest})

    def generate_text(self, payload: dict[str, Any]) -> None:
        self.session.generate(payload)

    def infer(self, payload: dict[str, Any]) -> None:
        generate_structured(self.session, payload)

    def close(self) -> None:
        self.session.unload()
        self.context.release_device(self.engine)


class ImageDriver:
    kind: Literal["image"] = "image"

    def __init__(self, context: WorkerContext) -> None:
        self.context = context
        self.engine = "fake"
        self.adapter: WorkerImageEngine | None = None

    def load(self, manifest: dict[str, Any]) -> None:
        self.engine = str(manifest["engine"])
        self.context.configure_device(self.engine)
        self.adapter = WorkerImageEngine(self.engine, str(manifest["localPath"]))

    def generate_image(self, payload: dict[str, Any]) -> None:
        if self.adapter is None:
            raise RuntimeError("IMAGE_MODEL_NOT_LOADED")
        self.adapter.generate(payload, self.context.signals, self.context.emit)

    def close(self) -> None:
        self.adapter = None
        self.context.release_device(self.engine)


class SpeechDriver:
    kind: Literal["speech"] = "speech"

    def __init__(self, context: WorkerContext) -> None:
        self.context = context
        self.engine = "fake"
        self.adapter: WorkerAudioEngine | None = None

    def load(self, manifest: dict[str, Any]) -> None:
        self.engine = str(manifest["engine"])
        self.context.configure_device(self.engine)
        self.adapter = WorkerAudioEngine(self.engine, str(manifest["localPath"]))

    def generate_audio(self, payload: dict[str, Any]) -> None:
        if self.adapter is None:
            raise RuntimeError("SPEECH_MODEL_NOT_LOADED")
        self.adapter.generate(payload, self.context.signals, self.context.emit)

    def close(self) -> None:
        if self.adapter:
            self.adapter.close()
            self.adapter = None
        self.context.release_device(self.engine)
