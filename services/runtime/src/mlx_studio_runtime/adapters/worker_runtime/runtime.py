"""Single active driver, from a static registry; IPC stays in the Worker host."""

from collections.abc import Callable, Mapping
from typing import Any

from mlx_studio_runtime.adapters.worker_runtime.context import WorkerContext
from mlx_studio_runtime.adapters.worker_runtime.drivers import ImageDriver, SpeechDriver, TextDriver

Driver = TextDriver | ImageDriver | SpeechDriver
Factory = Callable[[WorkerContext], Driver]
DEFAULT_DRIVERS: Mapping[str, Factory] = {
    "text-generation": TextDriver,
    "vision-language": TextDriver,
    "image-generation": ImageDriver,
    "text-to-speech": SpeechDriver,
}


class WorkerRuntime:
    def __init__(
        self, context: WorkerContext, registry: Mapping[str, Factory] = DEFAULT_DRIVERS
    ) -> None:
        self.context = context
        self.registry = dict(registry)
        self.driver: Driver | None = None

    def load(self, manifest: dict[str, Any]) -> None:
        self.unload()
        factory = self.registry.get(str(manifest.get("task", "text-generation")))
        if factory is None:
            raise ValueError("MODEL_TASK_UNSUPPORTED")
        driver = factory(self.context)
        self.driver = driver
        self.context.emit("model.loading", {"model_id": manifest["id"]})
        try:
            driver.load(manifest)
        except BaseException:
            self.unload()
            raise
        self.context.emit(
            "model.loaded", {"model_id": manifest["id"], "engine": manifest["engine"]}
        )

    def generate_text(self, payload: dict[str, Any]) -> None:
        if not isinstance(self.driver, TextDriver):
            raise RuntimeError("TEXT_MODEL_NOT_LOADED")
        self.driver.generate_text(payload)

    def infer(self, payload: dict[str, Any]) -> None:
        if not isinstance(self.driver, TextDriver):
            raise RuntimeError("TEXT_MODEL_NOT_LOADED")
        self.driver.infer(payload)

    def generate_image(self, payload: dict[str, Any]) -> None:
        if not isinstance(self.driver, ImageDriver):
            raise RuntimeError("IMAGE_MODEL_NOT_LOADED")
        self.driver.generate_image(payload)

    def generate_audio(self, payload: dict[str, Any]) -> None:
        if not isinstance(self.driver, SpeechDriver):
            raise RuntimeError("SPEECH_MODEL_NOT_LOADED")
        self.driver.generate_audio(payload)

    def unload(self) -> None:
        if self.driver:
            self.driver.close()
            self.driver = None
