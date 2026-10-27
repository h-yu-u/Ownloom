"""Local media tools invoke existing use cases; never hold a parent inference lease."""

import asyncio
import secrets
from typing import Any

from mlx_studio_runtime.application.image_generation_service import ImageGenerationService
from mlx_studio_runtime.application.ports import JobRepository
from mlx_studio_runtime.application.speech_generation_service import SpeechGenerationService
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.image_generation import ImageParameters
from mlx_studio_runtime.domain.speech import SpeechParameters


class BuiltinToolBridge:
    def __init__(
        self, images: ImageGenerationService, speech: SpeechGenerationService, jobs: JobRepository
    ) -> None:
        self.images, self.speech, self.jobs = images, speech, jobs

    def plan(self, action: str, args: dict[str, Any], bindings: dict[str, Any]) -> dict[str, Any]:
        if action == "image_generate":
            if set(args) - {"prompt", "width", "height", "steps", "seed", "strength"}:
                raise RuntimeFault(RuntimeErrorInfo("CAPABILITY_INPUT_INVALID", "图片工具输入无效"))
            return {
                "model_id": bindings["imageModelId"],
                "prompt": args["prompt"],
                "width": args.get("width", 512),
                "height": args.get("height", 512),
                "steps": args.get("steps", 20),
                "seed": args.get("seed", secrets.randbits(32)),
                "submitted_seed": args.get("seed"),
                "mode": bindings.get("imageMode", "generate"),
                "reference_ids": tuple(bindings.get("imageReferenceIds", [])),
                "mask_id": bindings.get("imageMaskId"),
                "strength": args.get("strength", 1.0),
            }
        if action == "speech_generate":
            if set(args) - {"text", "language"}:
                raise RuntimeFault(RuntimeErrorInfo("CAPABILITY_INPUT_INVALID", "语音工具输入无效"))
            return {
                "model_id": bindings["speechModelId"],
                "mode": bindings["speechMode"],
                "text": args["text"],
                "language": args.get("language", "auto"),
                "speaker": bindings.get("speaker"),
                "voice_id": bindings.get("voiceId"),
            }
        raise RuntimeFault(RuntimeErrorInfo("CAPABILITY_ACTION_NOT_ALLOWED", "未授权此动作"))

    async def create(self, action: str, plan: dict[str, Any], submission: str) -> str:
        try:
            if action == "image_generate":
                parameters = ImageParameters(
                    **{key: value for key, value in plan.items() if key != "submitted_seed"}
                )
                job = await self.images.create(parameters, submission, plan["submitted_seed"])
            else:
                job = await self.speech.create(SpeechParameters(**plan), submission)
            return str(job["id"])
        except ValueError as error:
            raise RuntimeFault(RuntimeErrorInfo(str(error), "媒体参数无效")) from error

    def recover(self, action: str, submission: str) -> str | None:
        previous = (
            self.images.repository.find_submission(submission)
            if action == "image_generate"
            else self.speech.repository.find_submission(submission)
        )
        return previous[0] if previous else None

    async def wait(self, action: str, job_id: str) -> dict[str, Any]:
        while True:
            job = (
                self.images.get_job(job_id)
                if action == "image_generate"
                else self.speech.get_job(job_id)
            )
            if job["state"] == "succeeded":
                artifact = job.get("artifact_id") or job.get("artifactId")
                if not artifact:
                    raise RuntimeFault(RuntimeErrorInfo("ARTIFACT_NOT_FOUND", "任务没有已保存作品"))
                return {
                    "childJobId": job_id,
                    "artifactRefs": [
                        {"kind": "image" if action == "image_generate" else "audio", "id": artifact}
                    ],
                    "state": "succeeded",
                }
            if job["state"] in {"failed", "cancelled"}:
                raise RuntimeFault(RuntimeErrorInfo("CHILD_JOB_FAILED", "媒体子任务未完成"))
            await asyncio.sleep(0.1)
