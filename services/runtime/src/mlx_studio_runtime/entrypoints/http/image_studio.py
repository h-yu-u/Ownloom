"""Image task, gallery, and authenticated local PNG endpoints."""

import secrets
from collections.abc import Awaitable, Callable
from typing import Literal

from fastapi import Depends, FastAPI, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.image_generation import ImageParameters
from mlx_studio_runtime.domain.jobs import JobState


class ImageJobRequest(BaseModel):
    client_request_id: str | None = Field(default=None, min_length=1, max_length=100)
    model_id: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=10_000, pattern=r"\S")
    width: int = Field(default=512, ge=64, le=2048, multiple_of=16)
    height: int = Field(default=512, ge=64, le=2048, multiple_of=16)
    steps: int = Field(default=20, ge=1, le=100)
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    mode: Literal["generate", "edit", "inpaint"] = "generate"
    reference_ids: list[str] = Field(default_factory=list, max_length=10)
    mask_id: str | None = Field(default=None, min_length=1, max_length=100)
    strength: float = Field(default=1.0, gt=0, le=1)


class ImageSnapshot(BaseModel):
    model_id: str
    model_name: str
    prompt: str
    width: int
    height: int
    steps: int
    seed: int
    simulated: bool
    mode: Literal["generate", "edit", "inpaint"] = "generate"
    reference_ids: list[str] = Field(default_factory=list)
    mask_id: str | None = None
    strength: float = 1.0


class ImageArtifactView(ImageSnapshot):
    id: str
    job_id: str
    created_at: int


class ImageJobView(ImageSnapshot):
    id: str
    state: JobState
    progress: int = Field(ge=0, le=100)
    created_at: int
    error_code: str | None
    artifact_id: str | None


def image_parameters(body: ImageJobRequest) -> ImageParameters:
    try:
        return ImageParameters(
            model_id=body.model_id,
            prompt=body.prompt.strip(),
            width=body.width,
            height=body.height,
            steps=body.steps,
            seed=body.seed if body.seed is not None else secrets.randbits(32),
            mode=body.mode,
            reference_ids=tuple(body.reference_ids),
            mask_id=body.mask_id,
            strength=body.strength,
        )
    except ValueError as error:
        raise RuntimeFault(
            RuntimeErrorInfo(str(error), "参考图或编辑参数无效，请检查后重试")
        ) from error


def register_image_studio_routes(
    app: FastAPI,
    service: RuntimeApplication,
    authenticate: Callable[..., Awaitable[None]],
) -> None:
    dependencies = [Depends(authenticate)]

    @app.post("/internal/v1/image-jobs", dependencies=dependencies, response_model=ImageJobView)
    async def create_image_job(body: ImageJobRequest) -> ImageJobView:
        parameters = image_parameters(body)
        return ImageJobView.model_validate(
            await service.images.create(parameters, body.client_request_id, body.seed)
        )

    @app.get(
        "/internal/v1/image-jobs", dependencies=dependencies, response_model=list[ImageJobView]
    )
    async def list_image_jobs() -> list[ImageJobView]:
        return [ImageJobView.model_validate(item) for item in service.images.list_jobs()]

    @app.get(
        "/internal/v1/image-jobs/{job_id}", dependencies=dependencies, response_model=ImageJobView
    )
    async def get_image_job(job_id: str) -> ImageJobView:
        return ImageJobView.model_validate(service.images.get_job(job_id))

    @app.post("/internal/v1/image-jobs/{job_id}/cancel", dependencies=dependencies)
    async def cancel_image_job(job_id: str) -> dict[str, str]:
        service.images.get_job(job_id)
        return await service.scheduler.cancel(job_id)

    @app.get(
        "/internal/v1/image-artifacts",
        dependencies=dependencies,
        response_model=list[ImageArtifactView],
    )
    async def image_history(
        limit: int = Query(default=24, ge=1, le=60),
        offset: int = Query(default=0, ge=0),
    ) -> list[ImageArtifactView]:
        return [
            ImageArtifactView.model_validate(item)
            for item in service.queries.history(limit, offset)
        ]

    @app.get(
        "/internal/v1/image-artifacts/{artifact_id}",
        dependencies=dependencies,
        response_model=ImageArtifactView,
    )
    async def artifact_detail(artifact_id: str) -> ImageArtifactView:
        return ImageArtifactView.model_validate(service.queries.image_artifact(artifact_id))

    @app.get("/internal/v1/image-artifacts/{artifact_id}/content", dependencies=dependencies)
    async def image_content(artifact_id: str, thumbnail: bool = False) -> FileResponse:
        return FileResponse(
            service.queries.image_content(artifact_id, thumbnail),
            media_type="image/png",
            filename=f"ownloom-{artifact_id}.png",
            content_disposition_type="inline",
        )
