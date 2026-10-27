"""Model registration and query projection with an injected static scanner."""

from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any, Protocol

from mlx_studio_runtime.application.ports import EventPublisher, ModelRepository
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.models import (
    ModelManifest,
    ModelSource,
    manifest_from_dict,
)


class ModelScanner(Protocol):
    def __call__(
        self,
        path: Path,
        source: ModelSource = "local",
        revision: str | None = None,
        display_name: str | None = None,
    ) -> ModelManifest: ...


class ModelCatalog:
    def __init__(
        self,
        repository: ModelRepository,
        events: EventPublisher,
        scanner: ModelScanner,
        check_available: Callable[[str, str], None],
    ) -> None:
        self.repository = repository
        self.events = events
        self.scan_directory = scanner
        self.check_available = check_available
        self.models: dict[str, ModelManifest] = {}
        self._restore_models()

    def _restore_models(self) -> None:
        for item in self.repository.list():
            try:
                manifest = manifest_from_dict(item)
            except (KeyError, TypeError, ValueError):
                continue
            self.models[manifest.id] = manifest
            if item.get("state") in {"loaded", "loading", "unloading"}:
                self.repository.update_state(manifest.id, "available")

    def list_models(self) -> list[dict[str, Any]]:
        return self.repository.list()

    async def scan_model(
        self,
        path: Path,
        source: ModelSource = "local",
        revision: str | None = None,
        display_name: str | None = None,
        managed_installation: bool = False,
    ) -> dict[str, Any]:
        try:
            manifest = self.scan_directory(
                path,
                source=source,
                revision=revision,
                display_name=display_name,
            )
        except (OSError, ValueError) as error:
            raise RuntimeFault(
                RuntimeErrorInfo("MODEL_METADATA_INVALID", "无法读取模型静态元数据")
            ) from error
        manifest = replace(manifest, managed_installation=managed_installation)
        existing = next(
            (
                item
                for item in self.models.values()
                if item.local_path == manifest.local_path
                and item.source == manifest.source
                and item.revision == manifest.revision
            ),
            None,
        )
        if existing:
            manifest = replace(
                manifest,
                id=existing.id,
                managed_installation=existing.managed_installation or managed_installation,
            )
        self.check_available(manifest.id, manifest.local_path)
        result = manifest.to_dict()
        self.repository.upsert(result, "available")
        self.models[manifest.id] = manifest
        await self.events.publish("model.discovered", {"model": result})
        return result

    def remove_registration(self, model_id: str) -> None:
        self.repository.remove(model_id)
        self.models.pop(model_id, None)

    def shared_path(self, model: ModelManifest) -> bool:
        return any(
            item.id != model.id and item.local_path == model.local_path
            for item in self.models.values()
        )
