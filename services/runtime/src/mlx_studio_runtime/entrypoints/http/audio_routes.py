"""Authenticated speech routes; bounded binary upload and shared job cancellation."""

from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.responses import FileResponse

from mlx_studio_runtime.adapters.audio_files import MAX_REFERENCE_BYTES
from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.speech import SpeechParameters
from mlx_studio_runtime.entrypoints.http.audio_contracts import (
    AudioArtifactView,
    AudioAssetView,
    AudioGenerationRequest,
    AudioJobView,
    VoiceCreate,
    VoicePatch,
    VoiceView,
)


def register_audio_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    dependencies = [Depends(authenticate)]

    @app.get(
        "/internal/v1/audio-assets", dependencies=dependencies, response_model=list[AudioAssetView]
    )
    async def reference_assets() -> list[AudioAssetView]:
        return [AudioAssetView.model_validate(item) for item in service.store.audio.references()]

    @app.post(
        "/internal/v1/audio-assets",
        dependencies=dependencies,
        response_model=AudioAssetView,
        status_code=201,
    )
    async def upload_audio(
        request: Request, filename: str = Query(default="reference.wav", max_length=160)
    ) -> AudioAssetView:
        content = bytearray()
        async for chunk in request.stream():
            if len(content) + len(chunk) > MAX_REFERENCE_BYTES:
                raise RuntimeFault(RuntimeErrorInfo("AUDIO_TOO_LARGE", "参考音频不能超过 12 MiB"))
            content.extend(chunk)
        return AudioAssetView.model_validate(await service.voices.upload(bytes(content), filename))

    @app.get("/internal/v1/audio-assets/{asset_id}/content", dependencies=dependencies)
    async def reference_content(asset_id: str) -> FileResponse:
        return FileResponse(
            service.voices.content(asset_id),
            media_type="audio/wav",
            content_disposition_type="inline",
        )

    @app.delete("/internal/v1/audio-assets/{asset_id}", dependencies=dependencies, status_code=204)
    async def delete_asset(asset_id: str) -> Response:
        service.voices.delete_asset(asset_id)
        return Response(status_code=204)

    @app.get("/internal/v1/voices", dependencies=dependencies, response_model=list[VoiceView])
    async def voices() -> list[VoiceView]:
        return [VoiceView.model_validate(item) for item in service.store.audio.voices()]

    @app.post(
        "/internal/v1/voices", dependencies=dependencies, response_model=VoiceView, status_code=201
    )
    async def create_voice(body: VoiceCreate) -> VoiceView:
        return VoiceView.model_validate(service.voices.create(body.model_dump()))

    @app.patch(
        "/internal/v1/voices/{voice_id}", dependencies=dependencies, response_model=VoiceView
    )
    async def update_voice(voice_id: str, body: VoicePatch) -> VoiceView:
        return VoiceView.model_validate(
            service.voices.update(voice_id, body.model_dump(exclude_unset=True))
        )

    @app.delete("/internal/v1/voices/{voice_id}", dependencies=dependencies, status_code=204)
    async def delete_voice(voice_id: str, delete_reference: bool = False) -> Response:
        service.voices.delete(voice_id, delete_reference)
        return Response(status_code=204)

    @app.post(
        "/internal/v1/audio-generations",
        dependencies=dependencies,
        response_model=AudioJobView,
        status_code=202,
    )
    async def generate(body: AudioGenerationRequest) -> AudioJobView:
        parameters = SpeechParameters(
            body.modelId, body.mode, body.text, body.language, body.speaker, body.voiceId
        )
        return AudioJobView.model_validate(
            await service.speech.create(parameters, body.clientRequestId)
        )

    @app.get(
        "/internal/v1/audio-generations",
        dependencies=dependencies,
        response_model=list[AudioJobView],
    )
    async def jobs() -> list[AudioJobView]:
        return [AudioJobView.model_validate(item) for item in service.store.audio.jobs()]

    @app.get(
        "/internal/v1/audio-generations/{job_id}",
        dependencies=dependencies,
        response_model=AudioJobView,
    )
    async def job(job_id: str) -> AudioJobView:
        return AudioJobView.model_validate(service.speech.get_job(job_id))

    @app.post("/internal/v1/audio-generations/{job_id}/cancel", dependencies=dependencies)
    async def cancel(job_id: str) -> dict[str, str]:
        service.speech.get_job(job_id)
        return await service.scheduler.cancel(job_id)

    @app.get(
        "/internal/v1/audio-artifacts",
        dependencies=dependencies,
        response_model=list[AudioArtifactView],
    )
    async def history(
        limit: int = Query(default=24, ge=1, le=60), offset: int = Query(default=0, ge=0)
    ) -> list[AudioArtifactView]:
        return [
            AudioArtifactView.model_validate(item)
            for item in service.store.audio.artifacts(limit, offset)
        ]

    @app.get(
        "/internal/v1/audio-artifacts/{artifact_id}",
        dependencies=dependencies,
        response_model=AudioArtifactView,
    )
    async def artifact_detail(artifact_id: str) -> AudioArtifactView:
        return AudioArtifactView.model_validate(service.speech.get_artifact(artifact_id))

    @app.get("/internal/v1/audio-artifacts/{artifact_id}/content", dependencies=dependencies)
    async def artifact_content(artifact_id: str) -> FileResponse:
        return FileResponse(
            service.speech.content(artifact_id),
            media_type="audio/wav",
            filename=f"ownloom-{artifact_id}.wav",
            content_disposition_type="inline",
        )

    @app.delete(
        "/internal/v1/audio-artifacts/{artifact_id}", dependencies=dependencies, status_code=204
    )
    async def delete_artifact(artifact_id: str) -> Response:
        service.speech.delete_artifact(artifact_id)
        return Response(status_code=204)
