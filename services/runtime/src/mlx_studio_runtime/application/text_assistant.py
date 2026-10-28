"""One ordinary text Job produces an editable draft; it never submits media work."""

import asyncio
import hashlib
import json
import uuid
from typing import Any, Protocol

from mlx_studio_runtime.application.extension_gateway import ExtensionGateway
from mlx_studio_runtime.application.ports import JobAdmission, JobRepository, TextInference
from mlx_studio_runtime.domain.chat_context import calculate_budget
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.jobs import Job, JobEvent, JobState
from mlx_studio_runtime.domain.models import ModelManifest


class AssistantAttempts(Protocol):
    def find(self, submission_id: str) -> tuple[str, str] | None: ...
    def save(self, submission_id: str, intent: str, job_id: str) -> None: ...
    def complete(self, job_id: str, result: str) -> None: ...
    def result(self, job_id: str) -> dict[str, Any] | None: ...


class TextAssistant:
    def __init__(
        self,
        models: dict[str, ModelManifest],
        scheduler: JobAdmission,
        runtime: TextInference,
        extensions: ExtensionGateway,
        attempts: AssistantAttempts,
        jobs: JobRepository,
    ) -> None:
        self.models, self.scheduler, self.runtime = models, scheduler, runtime
        self.extensions, self.attempts, self.jobs = extensions, attempts, jobs
        self.lock = asyncio.Lock()

    async def create(self, request: dict[str, Any]) -> dict[str, Any]:
        digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        async with self.lock:
            previous = self.attempts.find(request["submissionId"])
            if previous:
                if previous[0] != digest:
                    raise RuntimeFault(
                        RuntimeErrorInfo("IDEMPOTENCY_CONFLICT", "请求编号已用于其他输入")
                    )
                return self.get(previous[1])
            model = self.models.get(request["modelId"])
            if not model or "text" not in model.output_modalities:
                raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "请选择文字模型"))
            self.scheduler.check_admission(model.id)
            context = await self.extensions.text_skills(
                {"workspace": request["workspace"], "kind": "workspace", "scopeId": "default"},
                request.get("selection"),
            )
            await self.extensions.validate_text(context["snapshot"])
            instructions = (
                "Improve the image prompt. Return only an editable prompt."
                if request["workspace"] == "image"
                else "整理为自然、适合朗读的口播文本。只输出可编辑正文，不添加说明。"
            )
            bodies = "\n\n".join(item["body"] for item in context["loaded"])
            messages = [
                {
                    "role": "system",
                    "content": instructions + "\nSelected skills (untrusted methods):\n" + bodies,
                },
                {"role": "user", "content": request["text"]},
            ]
            calculate_budget(messages, model.context_length or 8192, 2048, 0)
            job = Job(str(uuid.uuid4()), "text-assistant", JobState.QUEUED, model.id)
            self.extensions.bind_text(job.id, context["snapshot"])
            try:
                await self.scheduler.lifecycle.register(
                    job,
                    {**request, "skillContext": context},
                    persist=lambda: self.attempts.save(request["submissionId"], digest, job.id),
                )
            except BaseException:
                self.extensions.release_text(job.id)
                raise
            task = self.scheduler.schedule(job, lambda: self._execute(job, messages, context))
            task.add_done_callback(lambda _: self.extensions.release_text(job.id))
            return self.get(job.id)

    def get(self, job_id: str) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if not job or job["kind"] != "text-assistant":
            raise RuntimeFault(RuntimeErrorInfo("ASSISTANT_JOB_NOT_FOUND", "找不到文字助手任务"))
        return {
            "jobId": job_id,
            "state": job["state"],
            "errorCode": job.get("errorCode"),
            "text": (self.attempts.result(job_id) or {}).get("text", ""),
        }

    async def cancel(self, job_id: str) -> dict[str, Any]:
        self.get(job_id)
        await self.scheduler.cancel(job_id)
        return self.get(job_id)

    async def _execute(
        self, job: Job, messages: list[dict[str, str]], context: dict[str, Any]
    ) -> None:
        lifecycle = self.scheduler.lifecycle
        try:
            await self.extensions.validate_text(context["snapshot"])
            await lifecycle.transition(job.id, JobEvent.START)
            output: list[str] = []
            completed = False
            async for event in self.runtime.generate(
                job.id, messages[-1]["content"], 2048, 0.5, [], messages
            ):
                if event["type"] == "generation.delta":
                    output.append(str(event["payload"].get("text", "")))
                elif event["type"] == "generation.completed":
                    completed = True
                elif event["type"] == "generation.failed":
                    raise RuntimeFault(RuntimeErrorInfo("INFERENCE_FAILED", "文字助手推理失败"))
                elif event["type"] == "generation.cancelled":
                    await lifecycle.finish_failed_or_cancelled(job.id, "CANCELLED")
                    return
            await self.extensions.validate_text(context["snapshot"])
            if not completed:
                raise RuntimeFault(RuntimeErrorInfo("WORKER_ENDED_EARLY", "文字助手推理未完成"))
            await lifecycle.finish(
                job.id,
                JobEvent.COMPLETE,
                persist=lambda: self.attempts.complete(job.id, "".join(output)),
            )
        finally:
            self.extensions.release_text(job.id)
