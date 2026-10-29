"""Serialize MTP changes with model leases and preserve persisted configuration."""

from collections.abc import Callable
from dataclasses import replace
from typing import Any

from mlx_studio_runtime.application.job_scheduler import JobScheduler
from mlx_studio_runtime.application.model_catalog import ModelCatalog
from mlx_studio_runtime.application.model_runtime import ModelRuntime
from mlx_studio_runtime.domain.drafts import DraftSettings
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.models import ModelManifest
from mlx_studio_runtime.domain.mtp import MtpSettings


class ModelAcceleration:
    def __init__(
        self,
        catalog: ModelCatalog,
        scheduler: JobScheduler,
        runtime: ModelRuntime,
        validate: Callable[[ModelManifest, MtpSettings], MtpSettings],
        validate_draft: Callable[[ModelManifest, DraftSettings], DraftSettings] | None = None,
    ) -> None:
        self.catalog, self.scheduler, self.runtime = catalog, scheduler, runtime
        self.validate = validate
        self.validate_draft = validate_draft

    async def configure(self, model_id: str, settings: MtpSettings | None) -> dict[str, Any]:
        async with self.scheduler.lock:
            self.scheduler.check_resources_available()
            self.scheduler.check_model_available(model_id)
            model = self.catalog.models.get(model_id)
            if model is None:
                raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "找不到此模型"))
            if settings is not None:
                try:
                    settings = self.validate(model, settings)
                except (OSError, ValueError) as error:
                    raise RuntimeFault(
                        RuntimeErrorInfo(
                            "MTP_CONFIG_INVALID",
                            "MTP 草稿不可用，请选择与主模型配套的本地 mtp 目录",
                        )
                    ) from error
            # Even an unchanged setting may need a reload after files were replaced.
            if self.runtime.active_model_id == model_id:
                await self.runtime.stop()
            updated = replace(model, mtp=settings, draft=None)
            result = updated.to_dict()
            self.catalog.repository.upsert(result, "available")
            self.catalog.models[model_id] = updated
            await self.catalog.events.publish("model.updated", {"model": result})
            return {**result, "state": "available"}

    async def configure_draft(self, model_id: str, settings: DraftSettings) -> dict[str, Any]:
        async with self.scheduler.lock:
            self.scheduler.check_resources_available()
            self.scheduler.check_model_available(model_id)
            model = self.catalog.models.get(model_id)
            if model is None:
                raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "找不到此模型"))
            try:
                if self.validate_draft is None:
                    raise ValueError("DRAFT_VALIDATOR_UNAVAILABLE")
                settings = self.validate_draft(model, settings)
            except (OSError, ValueError) as error:
                raise RuntimeFault(
                    RuntimeErrorInfo(
                        "DRAFT_CONFIG_INVALID", "草稿不可用，请检查本地目录与主模型是否配套"
                    )
                ) from error
            if self.runtime.active_model_id == model_id:
                await self.runtime.stop()
            updated = replace(model, draft=settings, mtp=None)
            result = updated.to_dict()
            self.catalog.repository.upsert(result, "available")
            self.catalog.models[model_id] = updated
            await self.catalog.events.publish("model.updated", {"model": result})
            return {**result, "state": "available"}
