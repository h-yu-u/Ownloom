"""Prepare a scoped provider independently of the HTTP entry point."""

from collections.abc import Callable
from typing import Any

from mlx_studio_runtime.application.coding_gateway import CodingGateway
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.generated.coding_rpc import RpcMethod
from mlx_studio_runtime.domain.models import ModelManifest


class CodingModelRequests:
    def __init__(
        self,
        gateway: CodingGateway,
        find_model: Callable[[str], ModelManifest | None],
        identity: Callable[[ModelManifest], tuple[str, str]],
    ) -> None:
        self.gateway, self.find_model, self.identity = gateway, find_model, identity

    async def call(
        self, method: RpcMethod, params: dict[str, object], base_url: str, model_id: str
    ) -> Any:
        model = self.find_model(model_id)
        if model is None or "text" not in model.output_modalities:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "请选择本地文本模型"))
        return await self.gateway.model_call(
            method,
            params,
            base_url,
            model.id,
            min(model.context_length or 32768, 32768),
            self.identity(model),
        )
