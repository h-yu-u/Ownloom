"""Filesystem boundary for Runtime-downloaded model directories."""

import asyncio
import os
import shutil
from pathlib import Path

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.models import ModelManifest


class ManagedModelFiles:
    def validate(self, model: ModelManifest) -> None:
        path = Path(model.local_path).resolve()
        root = (
            Path(os.getenv("MLX_STUDIO_MODELS_DIR", Path.home() / "MLXModels"))
            .expanduser()
            .resolve()
        )
        # Imported paths never establish ownership, even inside the download root.
        if (
            not model.managed_installation
            or model.source != "huggingface"
            or not path.is_dir()
            or path == root
            or not path.is_relative_to(root)
        ):
            raise RuntimeFault(RuntimeErrorInfo("MODEL_PATH_NOT_MANAGED", "此目录不属于托管模型"))

    async def delete(self, model: ModelManifest) -> None:
        self.validate(model)
        await asyncio.to_thread(shutil.rmtree, Path(model.local_path).resolve())
