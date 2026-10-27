"""Optional MFLUX 0.22.x adapter. All MLX imports remain inside the Worker boundary."""

import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from mlx_studio_runtime.adapters.model_scan import read_model_metadata, supports_qwen21_edit


class MfluxImageEngine:
    def __init__(self, path: str) -> None:
        # Never fetch additional model components implicitly during local inference.
        os.environ["HF_HUB_OFFLINE"] = "1"
        from mflux.models.common.config import ModelConfig  # type: ignore[import-not-found]

        root = Path(path)
        metadata, index = read_model_metadata(root)
        model_type = metadata.get("model_type")
        pipeline = index.get("_class_name")
        self.editing = supports_qwen21_edit(root, index)
        if self.editing:
            from mflux.models.qwen21.variants.edit.qwen_image_21_edit import (  # type: ignore[import-not-found]
                QwenImage21Edit,
            )

            self.model: Any = QwenImage21Edit(
                model_config=ModelConfig.qwen_image_21(), model_path=path
            )
        elif pipeline == "QwenImage21Pipeline" or model_type == "qwen_image_21":
            from mflux.models.qwen21.variants.txt2img.qwen_image_21 import (  # type: ignore[import-not-found]
                QwenImage21,
            )

            self.model = QwenImage21(model_config=ModelConfig.qwen_image_21(), model_path=path)
        elif pipeline == "FluxPipeline" or model_type == "flux":
            from mflux.models.flux.variants.txt2img.flux import (  # type: ignore[import-not-found]
                Flux1,
            )

            guidance = _metadata(root / "transformer" / "config.json").get("guidance_embeds")
            if not isinstance(guidance, bool):
                raise ValueError("IMAGE_MODEL_VARIANT_UNKNOWN")
            config = ModelConfig.dev() if guidance else ModelConfig.schnell()
            self.model = Flux1(model_config=config, model_path=path)
        elif pipeline == "QwenImagePipeline":
            from mflux.models.qwen.variants.txt2img.qwen_image import (  # type: ignore[import-not-found]
                QwenImage,
            )

            self.model = QwenImage(model_config=ModelConfig.qwen_image(), model_path=path)
        else:
            raise ValueError("IMAGE_MODEL_NOT_SUPPORTED")

    def generate(
        self, parameters: dict[str, Any], output: Path, progress: Callable[[int], None]
    ) -> None:
        class ProgressCallback:
            def call_in_loop(self, t: int, **_kwargs: Any) -> None:
                progress(t + 1)

        callback = ProgressCallback()
        self.model.callbacks.register(callback)
        try:
            edit_options: dict[str, Any] = {}
            if getattr(self, "editing", False):
                edit_options = {
                    "image_paths": parameters.get("image_paths", []),
                    "mask_image": parameters.get("mask_path"),
                    "strength": parameters.get("strength", 1.0),
                    "output_resolution": min(
                        1024, max(512, parameters["width"], parameters["height"])
                    ),
                }
            image = self.model.generate_image(
                seed=parameters["seed"],
                prompt=parameters["prompt"],
                width=parameters["width"],
                height=parameters["height"],
                num_inference_steps=parameters["steps"],
                **edit_options,
            )
            image.save(path=str(output))
        finally:
            self.model.callbacks.in_loop.remove(callback)


def _metadata(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("MODEL_METADATA_INVALID")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("MODEL_METADATA_INVALID")
    return value
