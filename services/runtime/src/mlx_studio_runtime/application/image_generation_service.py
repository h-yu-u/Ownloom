"""Image task orchestration sharing the Runtime generation lock and job lifecycle."""

import hashlib
import json
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from mlx_studio_runtime.application.ports import ImageInference, ImageRepository, JobAdmission
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.image_generation import ImageParameters
from mlx_studio_runtime.domain.jobs import Job, JobEvent, JobState
from mlx_studio_runtime.domain.models import ModelManifest


class ImageStorage(Protocol):
    def temporary(self, job_id: str) -> Path: ...
    async def validate(self, path: Path, width: int, height: int) -> None: ...
    def commit(self, path: Path, artifact_id: str) -> str: ...
    def discard(self, path: Path) -> None: ...
    def compensate(self, relative: str) -> None: ...


class ImageGenerationService:
    def __init__(
        self,
        models: dict[str, ModelManifest],
        scheduler: JobAdmission,
        runtime: ImageInference,
        repository: ImageRepository,
        files: ImageStorage,
        attachment_paths: Callable[[list[str]], list[str]] | None = None,
    ) -> None:
        self.models = models
        self.scheduler = scheduler
        self.model_runtime = runtime
        self.repository = repository
        self.files = files
        self.attachment_paths = attachment_paths
        self.lifecycle = scheduler.lifecycle
        self.progress: dict[str, int] = {}

    async def create(
        self,
        parameters: ImageParameters,
        request_id: str | None = None,
        submitted_seed: int | None = None,
    ) -> dict[str, Any]:
        request = dict(parameters.to_dict(), seed=submitted_seed)
        digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        if request_id:
            previous = self.repository.find_submission(request_id)
            if previous:
                if previous[1] != digest:
                    raise RuntimeFault(
                        RuntimeErrorInfo("IDEMPOTENCY_CONFLICT", "请求编号已用于不同输入")
                    )
                return self.get_job(previous[0])
        self.scheduler.check_admission(parameters.model_id)
        model = self.models.get(parameters.model_id)
        if model is None:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "请选择已下载的生图模型"))
        if model.task != "image-generation" or "image" not in model.output_modalities:
            raise RuntimeFault(RuntimeErrorInfo("IMAGE_MODEL_INVALID", "此模型不支持图片生成"))
        self._validate_edit(model, parameters)
        job = Job(str(uuid.uuid4()), "image", JobState.QUEUED, model.id)
        snapshot = dict(
            parameters.to_dict(), model_name=model.display_name, simulated=model.engine == "fake"
        )
        if request_id:
            snapshot.update(clientRequestId=request_id, requestDigest=digest)
        await self.lifecycle.register(job, snapshot)
        self.scheduler.schedule(job, lambda: self._run(job, parameters, snapshot))
        return self.get_job(job.id)

    def get_job(self, job_id: str) -> dict[str, Any]:
        rows = self.repository.jobs(job_id)
        if not rows:
            raise RuntimeFault(RuntimeErrorInfo("IMAGE_JOB_NOT_FOUND", "找不到图片生成任务"))
        return self._view(rows[0])

    def list_jobs(self) -> list[dict[str, Any]]:
        return [self._view(item) for item in self.repository.jobs()]

    def _view(self, item: dict[str, Any]) -> dict[str, Any]:
        return dict(
            item, progress=100 if item["state"] == "succeeded" else self.progress.get(item["id"], 0)
        )

    async def _run(
        self, job: Job, parameters: ImageParameters, snapshot: dict[str, object]
    ) -> None:
        output = self.files.temporary(job.id)
        try:
            await self._generate(job, parameters, output, snapshot)
        finally:
            self.files.discard(output)
            self.progress.pop(job.id, None)

    async def _generate(
        self,
        job: Job,
        parameters: ImageParameters,
        output: Path,
        snapshot: dict[str, object],
    ) -> None:
        if self._cancelled(job.id):
            await self.lifecycle.finish(job.id, JobEvent.CANCEL_COMPLETE)
            return
        await self.lifecycle.transition(job.id, JobEvent.START)
        completed = False
        worker_parameters = parameters.to_dict()
        if parameters.reference_ids:
            worker_parameters["input_files"] = self._input_files(parameters)
        async for event in self.model_runtime.generate_image(job.id, worker_parameters, output):
            kind, payload = event["type"], event["payload"]
            if kind == "image.progress":
                self.progress[job.id] = min(
                    99, max(0, int(payload["step"]) * 100 // parameters.steps)
                )
                await self.model_runtime.events.publish(kind, payload)
            elif kind == "generation.cancelled":
                await self.lifecycle.finish_failed_or_cancelled(job.id, "IMAGE_CANCELLED")
                return
            elif kind == "generation.failed":
                raise RuntimeError("IMAGE_GENERATION_FAILED")
            elif kind == "generation.completed":
                completed = True
        if self._cancelled(job.id):
            await self.lifecycle.finish(job.id, JobEvent.CANCEL_COMPLETE)
            return
        if not completed:
            raise RuntimeError("IMAGE_WORKER_ENDED_EARLY")
        await self._save_output(job, parameters, output, snapshot)

    async def _save_output(
        self,
        job: Job,
        parameters: ImageParameters,
        output: Path,
        snapshot: dict[str, object],
    ) -> None:
        await self.files.validate(output, parameters.width, parameters.height)
        if self._cancelled(job.id):
            await self.lifecycle.finish(job.id, JobEvent.CANCEL_COMPLETE)
            return
        artifact_id = str(uuid.uuid4())
        relative = self.files.commit(output, artifact_id)
        try:
            await self.lifecycle.finish(
                job.id,
                JobEvent.COMPLETE,
                persist=lambda: self.repository.save(artifact_id, job.id, relative, snapshot),
            )
        except Exception:
            self.files.compensate(relative)
            raise
        await self.model_runtime.events.publish(
            "image.created", {"job_id": job.id, "artifact_id": artifact_id}
        )

    def _cancelled(self, job_id: str) -> bool:
        return self.lifecycle.cancellation_requested(job_id)

    def _validate_edit(self, model: ModelManifest, parameters: ImageParameters) -> None:
        if (
            model.engine != "fake"
            and model.capabilities.image_editing
            and (parameters.width % 32 or parameters.height % 32)
        ):
            raise RuntimeFault(
                RuntimeErrorInfo("IMAGE_DIMENSIONS_INVALID", "此模型宽高须为 32 的倍数")
            )
        if parameters.mode == "generate":
            return
        if not model.capabilities.image_editing or (
            parameters.mode == "inpaint" and not model.capabilities.inpainting
        ):
            raise RuntimeFault(
                RuntimeErrorInfo("IMAGE_EDIT_UNSUPPORTED", "请选择支持图片编辑的完整模型")
            )
        if len(parameters.reference_ids) > 1 and not model.capabilities.multi_image:
            raise RuntimeFault(
                RuntimeErrorInfo("IMAGE_REFERENCES_INVALID", "此模型只支持一张参考图")
            )
        self._input_files(parameters)

    def _input_files(self, parameters: ImageParameters) -> dict[str, object]:
        if self.attachment_paths is None:
            raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_NOT_FOUND", "参考图不可用，请重新上传"))
        paths = self.attachment_paths(list(parameters.reference_ids))
        mask = self.attachment_paths([parameters.mask_id])[0] if parameters.mask_id else None
        return {"image_paths": paths, "mask_path": mask}
