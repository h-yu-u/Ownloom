# Copyright (c) 2026 Z Lab. MIT; see LICENSE in this directory.
# Adapted from z-lab/dflash@07ebd93db9f472af339b644bb70221ad8428328a/model_mlx.py.
# Network/selector math retained; target generation and remote loading excluded.
# pyright: basic
from dataclasses import dataclass, field
from typing import Any, cast


@dataclass
class DFlashConfig:
    hidden_size: int
    num_hidden_layers: int
    num_attention_heads: int
    num_key_value_heads: int
    head_dim: int
    intermediate_size: int
    vocab_size: int
    rms_norm_eps: float
    rope_theta: float
    max_position_embeddings: int
    block_size: int
    target_layer_ids: tuple[int, ...]
    num_target_layers: int
    mask_token_id: int = 0
    rope_scaling: dict[str, Any] | None = None
    layer_types: tuple[str, ...] = field(default_factory=tuple)
    sliding_window: int | None = None
    final_logit_softcapping: float | None = None
    input_embedding_scale: float = 1.0
    output_multiplier: float = 1.0
    conv_kernel_size: int = 0
    conv_group_size: int = 0
    selector_rank: int = 0
    selector_top_k: int = 0
    is_causal: bool | None = None


def _integer(data: dict[str, object], key: str, maximum: int, minimum: int = 1) -> int:
    value = data.get(key)
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("DFLASH_CONFIG_INVALID")
    return value


def _architecture(data: dict[str, object]) -> tuple[dict[str, object], int, int, tuple[int, ...]]:
    raw = data.get("dflash_config")
    if not isinstance(raw, dict) or data.get("architectures") != ["DFlash2DraftModel"]:
        raise ValueError("DFLASH_CONFIG_INVALID")
    detail = cast(dict[str, object], raw)
    layers = _integer(data, "num_hidden_layers", 16)
    target_layers = _integer(data, "num_target_layers", 256)
    ids = detail.get("target_layer_ids")
    if (
        not isinstance(ids, list)
        or not ids
        or any(type(i) is not int or not 0 <= i < target_layers for i in ids)
        or ids != sorted(set(ids))
    ):
        raise ValueError("DFLASH_CONFIG_INVALID")
    if data.get("layer_types") != ["sliding_attention"] * layers:
        raise ValueError("DFLASH_CONFIG_INVALID")
    if data.get("is_causal") is not False:
        raise ValueError("DFLASH_CONFIG_INVALID")
    if detail.get("conv_kernel_size") != 2 or _integer(detail, "block_size", 64) < 5:
        raise ValueError("DFLASH_CONFIG_INVALID")
    for key in ("input_embedding_scale", "output_multiplier"):
        if detail.get(key, 1.0) != 1.0:
            raise ValueError("DFLASH_CONFIG_INVALID")
    if detail.get("final_logit_softcapping", data.get("final_logit_softcapping")) is not None:
        raise ValueError("DFLASH_CONFIG_INVALID")
    return detail, layers, target_layers, tuple(ids)


def _rope_parameters(data: dict[str, object]) -> tuple[dict[str, Any], float, float]:
    rope = data.get("rope_parameters") or data.get("rope_scaling")
    if not isinstance(rope, dict) or rope.get("rope_type") != "default":
        raise ValueError("DFLASH_CONFIG_INVALID")
    theta, eps = rope.get("rope_theta"), data.get("rms_norm_eps")
    if not isinstance(theta, (int, float)) or isinstance(theta, bool) or not 0 < theta <= 1e12:
        raise ValueError("DFLASH_CONFIG_INVALID")
    if not isinstance(eps, (int, float)) or isinstance(eps, bool) or not 0 < eps < 1:
        raise ValueError("DFLASH_CONFIG_INVALID")
    return cast(dict[str, Any], rope), float(theta), float(eps)


def parse_config(data: dict[str, object]) -> DFlashConfig:
    detail, layers, target_layers, ids = _architecture(data)
    rope, theta, eps = _rope_parameters(data)
    hidden = _integer(data, "hidden_size", 16384)
    group = _integer(detail, "conv_group_size", hidden)
    heads = _integer(data, "num_attention_heads", 128)
    kv_heads = _integer(data, "num_key_value_heads", 128)
    if hidden % group or heads % kv_heads:
        raise ValueError("DFLASH_CONFIG_INVALID")
    return DFlashConfig(
        hidden_size=hidden,
        num_hidden_layers=layers,
        num_attention_heads=heads,
        num_key_value_heads=kv_heads,
        head_dim=_integer(data, "head_dim", 512),
        intermediate_size=_integer(data, "intermediate_size", 131072),
        vocab_size=_integer(data, "vocab_size", 1000000),
        rms_norm_eps=float(eps),
        rope_theta=float(theta),
        max_position_embeddings=_integer(data, "max_position_embeddings", 1048576),
        block_size=_integer(detail, "block_size", 64),
        target_layer_ids=tuple(ids),
        num_target_layers=target_layers,
        mask_token_id=_integer(
            detail, "mask_token_id", _integer(data, "vocab_size", 1000000) - 1, 0
        ),
        rope_scaling=cast(dict[str, Any], rope),
        layer_types=("sliding_attention",) * layers,
        sliding_window=_integer(data, "sliding_window", 4096, 2),
        conv_kernel_size=_integer(detail, "conv_kernel_size", 5),
        conv_group_size=group,
        selector_rank=_integer(detail, "selector_rank", 1024),
        selector_top_k=_integer(detail, "selector_top_k", 64),
        is_causal=False,
    )
