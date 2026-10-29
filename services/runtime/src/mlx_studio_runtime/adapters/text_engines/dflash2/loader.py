"""Strictly load every local DFlash2 tensor, quantize, then bind the target elsewhere."""

from pathlib import Path

import mlx.core as mx  # type: ignore[import-not-found]
from mlx import nn  # type: ignore[import-not-found]

from mlx_studio_runtime.adapters.mtp_metadata import read_config
from mlx_studio_runtime.adapters.text_engines.dflash2.config import parse_config
from mlx_studio_runtime.adapters.text_engines.dflash2.model import DFlash2DraftModel


def load_draft(directory: str) -> DFlash2DraftModel:
    path = Path(directory)
    config = parse_config(read_config(path))
    weights = mx.load(str(path / "model.safetensors"))
    if not isinstance(weights, dict):
        raise ValueError("DFLASH_WEIGHTS_INVALID")
    for name in ("predecessor_codebook", "successor_codebook"):
        key = f"candidate_selector.{name}"
        weights[f"{key}.weight"] = weights.pop(key)
    model = DFlash2DraftModel(config)
    model.eval()
    model.load_weights(list(weights.items()), strict=True)
    nn.quantize(model, group_size=64, bits=4)
    mx.eval(model.parameters())
    return model
