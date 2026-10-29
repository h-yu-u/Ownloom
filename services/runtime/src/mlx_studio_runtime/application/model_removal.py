"""Removal orchestration; concrete storage and inference resources are injected."""

from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Protocol

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.models import ModelManifest


class ManagedModelStorage(Protocol):
    def validate(self, model: ModelManifest) -> None: ...
    async def delete(self, model: ModelManifest) -> None: ...


@dataclass(frozen=True)
class ModelRemovalPorts:
    find: Callable[[str], ModelManifest | None]
    remove: Callable[[str], None]
    reserve: Callable[[str], AbstractAsyncContextManager[None]]
    unload: Callable[[str], Awaitable[None]]
    shared_path: Callable[[ModelManifest], bool]


class RemoveModel:
    def __init__(self, ports: ModelRemovalPorts, storage: ManagedModelStorage) -> None:
        self.ports = ports
        self.storage = storage

    async def execute(self, model_id: str, delete_files: bool = False) -> dict[str, bool]:
        async with self.ports.reserve(model_id):
            model = self.ports.find(model_id)
            if model is None or model.source == "builtin":
                raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "找不到可移除的模型"))
            if delete_files:
                if self.ports.shared_path(model):
                    raise RuntimeFault(
                        RuntimeErrorInfo(
                            "MODEL_IN_USE", "此目录仍被其他模型登记或 MTP 设置引用，请先移除引用"
                        )
                    )
                self.storage.validate(model)
            try:
                await self.ports.unload(model_id)
                if delete_files:
                    await self.storage.delete(model)
                self.ports.remove(model_id)
            except OSError as error:
                raise RuntimeFault(
                    RuntimeErrorInfo(
                        "MODEL_REMOVAL_FAILED",
                        "模型移除失败，登记已保留以便重试",
                        True,
                    )
                ) from error
        return {"removed": True}
