"""Owns the loaded model and Worker; only the scheduler grants execution leases."""

from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.ports import EventPublisher, InferenceWorker, ModelRepository
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.models import ModelManifest
from mlx_studio_runtime.domain.runtime_state import RuntimeState


class ModelRuntime:
    def __init__(
        self,
        models: dict[str, ModelManifest],
        repository: ModelRepository,
        events: EventPublisher,
        create_worker: Callable[[], InferenceWorker],
    ) -> None:
        self.models = models
        self.repository = repository
        self.events = events
        self.create_worker = create_worker
        self.worker: InferenceWorker | None = None
        self.active_model_id: str | None = None
        self.loading_model_id: str | None = None
        self.epoch = 0
        self.phase = "stopped"
        self.state = RuntimeState.READY
        self.worker_restarts = 0

    def _execution_worker(self) -> InferenceWorker:
        if self.worker is None:
            raise RuntimeFault(RuntimeErrorInfo("WORKER_NOT_AVAILABLE", "Worker 不可用"))
        return self.worker

    def generate(
        self,
        job_id: str,
        prompt: str,
        max_tokens: int | None,
        temperature: float,
        image_paths: list[str],
        messages: list[dict[str, str]],
    ) -> AsyncIterator[dict[str, Any]]:
        return self._execution_worker().generate(
            job_id, prompt, max_tokens, temperature, image_paths, messages
        )

    def generate_image(
        self, job_id: str, parameters: dict[str, object], output_path: Path
    ) -> AsyncIterator[dict[str, Any]]:
        return self._execution_worker().generate_image(job_id, parameters, output_path)

    def generate_audio(
        self, job_id: str, parameters: dict[str, object], output_path: Path
    ) -> AsyncIterator[dict[str, Any]]:
        return self._execution_worker().generate_audio(job_id, parameters, output_path)

    def infer(self, job_id: str, request: dict[str, object]) -> AsyncIterator[dict[str, Any]]:
        return self._execution_worker().infer(job_id, request)

    async def load(self, model_id: str) -> dict[str, Any]:
        manifest = self.models.get(model_id)
        if manifest is None:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "找不到此模型"))
        if manifest.engine not in {"fake", "mlx-lm", "mlx-vlm", "mflux", "mlx-audio"}:
            raise RuntimeFault(
                RuntimeErrorInfo(
                    "ENGINE_NOT_AVAILABLE",
                    "该模型引擎尚未接入 Runtime Worker",
                    details={"engine": manifest.engine},
                )
            )
        if self.active_model_id == model_id and self.worker is not None:
            return {"modelId": model_id, "state": "loaded"}
        await self.stop()
        self.loading_model_id = model_id
        self.phase = "loading"
        self.epoch += 1
        epoch = self.epoch
        self.repository.update_state(model_id, "loading")
        await self.events.publish("model.loading", {"model_id": model_id})
        worker = self.create_worker()
        self.worker = worker
        try:
            await worker.load(manifest.to_dict())
        except BaseException as error:
            await self.stop(worker)
            if not isinstance(error, Exception):
                if self.epoch == epoch and self.worker is None:
                    self.state = RuntimeState.READY
                raise
            if self.epoch == epoch:
                self.repository.update_state(model_id, "error")
                self.state = RuntimeState.DEGRADED
                self.phase = "failed"
                await self.events.publish("runtime.degraded", {"reason": "worker_load_failed"})
            code = str(getattr(error, "code", "MODEL_LOAD_FAILED"))
            if code == "WORKER_COMMAND_FAILED":
                code = "MODEL_LOAD_FAILED"
            raise RuntimeFault(RuntimeErrorInfo(code, "模型加载失败", True)) from error
        if self.worker is not worker or self.epoch != epoch:
            raise RuntimeFault(RuntimeErrorInfo("WORKER_REPLACED", "加载已被中断"))
        self.loading_model_id = None
        self.phase = "ready"
        self.active_model_id = model_id
        self.repository.update_state(model_id, "loaded")
        self.state = RuntimeState.READY
        await self.events.publish("model.loaded", {"model_id": model_id})
        return {"modelId": model_id, "state": "loaded"}

    async def stop(self, expected: InferenceWorker | None = None) -> None:
        worker = self.worker
        if expected is not None and worker is not expected:
            await expected.stop()
            return
        model_id = self.active_model_id or self.loading_model_id
        if worker:
            self.phase = "stopping"
            try:
                await worker.stop()
            except BaseException:
                if self.worker is worker:
                    self.state = RuntimeState.DEGRADED
                    self.phase = "failed"
                raise
        if self.worker is not worker:
            return
        self.worker = None
        self.active_model_id = None
        self.loading_model_id = None
        self.phase = "stopped"
        if model_id:
            self.repository.update_state(model_id, "available")
            await self.events.publish("model.unloaded", {"model_id": model_id})
