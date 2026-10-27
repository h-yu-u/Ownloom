"""Speech submissions share the existing scheduler, worker and job terminal rules."""

import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.audio_ports import AudioRepository, AudioStorage
from mlx_studio_runtime.application.ports import JobAdmission, SpeechInference
from mlx_studio_runtime.application.voice_profile_service import VoiceProfileService
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.jobs import Job, JobEvent, JobState
from mlx_studio_runtime.domain.models import ModelManifest
from mlx_studio_runtime.domain.speech import SpeechParameters, speech_error_code, validate_speech


class SpeechGenerationService:
    def __init__(
        self,
        models: dict[str, ModelManifest],
        scheduler: JobAdmission,
        runtime: SpeechInference,
        repository: AudioRepository,
        files: AudioStorage,
        voices: VoiceProfileService,
    ) -> None:
        self.models, self.scheduler, self.runtime = models, scheduler, runtime
        self.repository, self.files, self.voices = repository, files, voices
        self.lifecycle = scheduler.lifecycle

    async def create(self, parameters: SpeechParameters, request_id: str) -> dict[str, Any]:
        digest = hashlib.sha256(
            json.dumps(parameters.to_dict(), sort_keys=True).encode()
        ).hexdigest()
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
            raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "请选择已下载的语音模型"))
        if model.task != "text-to-speech":
            raise RuntimeFault(RuntimeErrorInfo("SPEECH_MODEL_INVALID", "此模型不支持语音生成"))
        validate_speech(parameters, model.speech)
        voice = self.voices.get(parameters.voice_id) if parameters.voice_id else None
        if voice:
            asset = self.voices.asset(str(voice["reference_asset_id"]))
            if not str(voice["reference_text"]).strip() or not voice["consent"]:
                raise RuntimeFault(
                    RuntimeErrorInfo("VOICE_REFERENCE_INVALID", "音色缺少参考原文或授权记录")
                )
            if asset["duration_seconds"] > 30:
                raise RuntimeFault(
                    RuntimeErrorInfo("VOICE_REFERENCE_INVALID", "参考音频不能超过 30 秒")
                )
            self.voices.content(str(asset["id"]))
        snapshot = dict(
            parameters.to_dict(),
            model_name=model.display_name,
            model_revision=model.revision,
            model_identity=model.artifact_identity,
            adapter_version=model.speech.adapter_version if model.speech else "",
            simulated=model.engine == "fake",
            voice_snapshot=voice,
            clientRequestId=request_id,
            requestDigest=digest,
        )
        job = Job(str(uuid.uuid4()), "audio", JobState.QUEUED, model.id)
        await self.lifecycle.register(job, snapshot)
        self.scheduler.schedule(job, lambda: self._run(job, snapshot))
        return self.get_job(job.id)

    def get_job(self, job_id: str) -> dict[str, Any]:
        rows = self.repository.jobs(job_id)
        if not rows:
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_JOB_NOT_FOUND", "找不到语音生成任务"))
        return rows[0]

    def get_artifact(self, artifact_id: str) -> dict[str, Any]:
        item = self.repository.artifact(artifact_id)
        if item is None:
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_ARTIFACT_NOT_FOUND", "找不到此作品"))
        return item

    def content(self, artifact_id: str) -> Path:
        return self.voices.content(str(self.get_artifact(artifact_id)["asset_id"]))

    def delete_artifact(self, artifact_id: str) -> None:
        item = self.repository.artifact(artifact_id)
        if item is None:
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_ARTIFACT_NOT_FOUND", "找不到此作品"))
        self.repository.delete_artifact(artifact_id)
        self.voices.delete_asset(str(item["asset_id"]))

    async def _run(self, job: Job, snapshot: dict[str, Any]) -> None:
        output = self.files.temporary(job.id)
        try:
            if self._cancelled(job.id):
                await self.lifecycle.finish(job.id, JobEvent.CANCEL_COMPLETE)
                return
            parameters = {key: snapshot[key] for key in ("mode", "text", "language", "speaker")}
            voice = snapshot["voice_snapshot"]
            if voice:
                parameters.update(
                    reference_path=str(self.voices.content(voice["reference_asset_id"])),
                    reference_text=voice["reference_text"],
                )
            await self.lifecycle.transition(job.id, JobEvent.START)
            started = time.monotonic()
            completed = False
            async for event in self.runtime.generate_audio(job.id, parameters, output):
                kind, payload = event["type"], event["payload"]
                if kind == "generation.failed":
                    raise RuntimeFault(
                        RuntimeErrorInfo(
                            str(payload.get("error_code", "SPEECH_GENERATION_FAILED")),
                            "语音生成失败",
                        )
                    )
                if kind == "generation.cancelled":
                    await self.lifecycle.finish_failed_or_cancelled(job.id, "AUDIO_CANCELLED")
                    return
                if kind == "generation.completed":
                    completed = True
            if self._cancelled(job.id):
                await self.lifecycle.finish(job.id, JobEvent.CANCEL_COMPLETE)
                return
            if not completed:
                raise RuntimeError("AUDIO_WORKER_ENDED_EARLY")
            await self._save(job, output, snapshot, time.monotonic() - started)
        except OSError as error:
            raise RuntimeFault(
                RuntimeErrorInfo(speech_error_code(error), "无法保存语音文件")
            ) from error
        finally:
            self.files.discard(output)

    async def _save(self, job: Job, output: Path, snapshot: dict[str, Any], elapsed: float) -> None:
        metadata = await self.files.validate(output)
        if self._cancelled(job.id):
            await self.lifecycle.finish(job.id, JobEvent.CANCEL_COMPLETE)
            return
        identifier, asset_id = str(uuid.uuid4()), str(uuid.uuid4())
        relative = self.files.commit(output, asset_id)
        asset = dict(
            metadata,
            id=asset_id,
            relative_path=relative,
            role="generated",
            original_name=f"{identifier}.wav",
            created_at=int(time.time()),
        )
        artifact = dict(
            snapshot,
            id=identifier,
            job_id=job.id,
            asset_id=asset_id,
            created_at=int(time.time()),
            duration_seconds=metadata["duration_seconds"],
            sample_rate=metadata["sample_rate"],
            channels=metadata["channels"],
            peaks=metadata["peaks"],
            elapsed_seconds=elapsed,
            rtf=elapsed / metadata["duration_seconds"],
        )

        def persist() -> None:
            self.repository.save_asset(asset)
            self.repository.save_artifact(artifact)

        try:
            await self.lifecycle.finish(job.id, JobEvent.COMPLETE, persist=persist)
        except Exception:
            self.files.remove(relative)
            raise
        await self.runtime.events.publish(
            "audio.created", {"job_id": job.id, "artifact_id": identifier}
        )

    def _cancelled(self, job_id: str) -> bool:
        return self.lifecycle.cancellation_requested(job_id)
