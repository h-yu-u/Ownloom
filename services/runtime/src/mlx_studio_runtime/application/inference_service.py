"""Each provider call obtains one normal inference lease, never a CodingRun lease."""

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from mlx_studio_runtime.application.ports import JobAdmission, StructuredInference
from mlx_studio_runtime.domain.context_budget import output_reserve
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.inference import validate_context, validate_result
from mlx_studio_runtime.domain.jobs import Job, JobEvent, JobState
from mlx_studio_runtime.domain.models import ModelManifest


class InferenceService:
    def __init__(
        self,
        models: dict[str, ModelManifest],
        scheduler: JobAdmission,
        inference: StructuredInference,
    ) -> None:
        self.models, self.scheduler, self.inference = models, scheduler, inference

    async def complete(
        self,
        request: dict[str, Any],
        on_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        return await self.wait(await self.admit(request, on_event=on_event))

    async def admit(
        self,
        request: dict[str, Any],
        persist: Callable[[Job], None] | None = None,
        on_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> tuple[str, asyncio.Future[dict[str, Any]], asyncio.Task[None]]:
        model_id = str(request["model"])
        try:
            validate_context(request["messages"], request["tools"])
        except (ValueError, KeyError, TypeError) as error:
            raise RuntimeFault(RuntimeErrorInfo("INFERENCE_CONTEXT_INVALID", str(error))) from error
        model = self.models.get(model_id)
        if model is None or "text" not in model.output_modalities:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "请选择文本模型"))
        request = {
            **request,
            "max_tokens": output_reserve(model.context_length or 32768, request.get("max_tokens")),
        }
        self.scheduler.check_admission(model_id)
        job = Job(str(uuid.uuid4()), "coding-inference", JobState.QUEUED, model_id)
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        await self.scheduler.lifecycle.register(
            job, {"kind": "coding-inference"}, persist=(lambda: persist(job)) if persist else None
        )

        accepted_at = time.monotonic()

        async def execute() -> None:
            trace: dict[str, Any] = {
                "jobId": job.id,
                "queueMs": round((time.monotonic() - accepted_at) * 1000),
            }
            first_token = False
            await self.scheduler.lifecycle.transition(job.id, JobEvent.START)
            staged: dict[str, Any] | None = None
            completed = False
            async for event in self.inference.infer(job.id, request):
                kind, payload = event["type"], event["payload"]
                if event.get("worker_epoch"):
                    trace.update(
                        workerEpoch=event["worker_epoch"], attemptId=event.get("attempt_id")
                    )
                if completed:
                    raise RuntimeFault(RuntimeErrorInfo("WORKER_PROTOCOL_INVALID", "重复终态"))
                if kind == "generation.result":
                    if staged is not None:
                        raise RuntimeFault(RuntimeErrorInfo("WORKER_PROTOCOL_INVALID", "重复结果"))
                    staged = validate_result(payload, request["tools"])
                elif kind == "generation.completed":
                    completed = True
                elif kind in {"generation.failed", "generation.cancelled"}:
                    code = str(
                        payload.get(
                            "error_code",
                            "INFERENCE_CANCELLED"
                            if kind.endswith("cancelled")
                            else "INFERENCE_FAILED",
                        )
                    )
                    raise RuntimeFault(
                        RuntimeErrorInfo(
                            code,
                            "结构化推理未完成",
                            details={
                                key: str(value) for key, value in payload.get("budget", {}).items()
                            },
                        )
                    )
                elif kind in {"generation.admitted", "text.delta"}:
                    if kind == "text.delta" and not first_token:
                        trace["firstTokenMs"] = round((time.monotonic() - accepted_at) * 1000)
                        first_token = True
                    if on_event:
                        await on_event(event)
            if not completed or staged is None:
                raise RuntimeFault(
                    RuntimeErrorInfo("INFERENCE_PROTOCOL_INCOMPLETE", "推理协议不完整")
                )
            result = {
                **staged,
                "trace": {**trace, "durationMs": round((time.monotonic() - accepted_at) * 1000)},
            }
            if request.get("tool_choice") == "none" and result["message"].get("tool_calls"):
                raise RuntimeFault(RuntimeErrorInfo("TOOL_CHOICE_VIOLATION", "本次未授权工具调用"))
            terminal = await self.scheduler.lifecycle.finish(
                job.id,
                JobEvent.COMPLETE,
                persist=lambda: self.scheduler.lifecycle.save_result(job.id, result),
            )
            if terminal.state is JobState.SUCCEEDED and not future.done():
                future.set_result(result)

        task = self.scheduler.schedule(job, execute)

        def settled(_: asyncio.Task[None]) -> None:
            if not future.done():
                code = self.scheduler.lifecycle.get(job.id).error_code or "INFERENCE_CANCELLED"
                future.set_exception(RuntimeFault(RuntimeErrorInfo(code, "结构化推理未完成")))

        task.add_done_callback(settled)
        return job.id, future, task

    async def wait(
        self, prepared: tuple[str, asyncio.Future[dict[str, Any]], asyncio.Task[None]]
    ) -> dict[str, Any]:
        job_id, future, task = prepared
        try:
            result = await future
            await asyncio.shield(task)
            if self.scheduler.lifecycle.get(job_id).state is not JobState.SUCCEEDED:
                raise RuntimeFault(RuntimeErrorInfo("INFERENCE_CANCELLED", "推理未成功提交"))
            return result
        except asyncio.CancelledError:
            await self.scheduler.cancel(job_id)
            raise
