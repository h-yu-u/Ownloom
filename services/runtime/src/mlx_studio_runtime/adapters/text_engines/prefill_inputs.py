"""Validate the narrow pure-text input contract used by manual Qwen prefill."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TextPrefillInput:
    ids: Any
    mask: Any
    tokens: list[int]

    def native_options(self, state: Any) -> dict[str, Any]:
        # VLM 0.6.14's input_ids fast path reads `mask`, not `attention_mask`.
        # Keep the FULL mask: Qwen needs it to derive absolute suffix positions.
        return {"input_ids": self.ids, "mask": self.mask, "prompt_cache_state": state}


def prepare_text_input(model: Any, processor: Any, rendered: str) -> TextPrefillInput | None:
    from mlx_vlm.apc import multimodal_token_ids_from_config  # type: ignore[import-not-found]
    from mlx_vlm.utils import (  # type: ignore[import-not-found]
        prepare_inputs,
        should_add_special_tokens,
    )

    if getattr(model.config, "model_type", None) != "qwen3_5":
        return None
    inputs = prepare_inputs(
        processor,
        prompts=rendered,
        add_special_tokens=should_add_special_tokens(model.config.model_type, processor),
    )
    ids, mask = inputs.get("input_ids"), inputs.get("attention_mask")
    shape = getattr(ids, "shape", ())
    if (
        set(inputs) != {"input_ids", "attention_mask"}
        or len(shape) != 2
        or shape[0] != 1
        or shape[1] <= 0
        or getattr(mask, "shape", None) != shape
    ):
        return None
    tokens = ids.reshape(-1).tolist()
    media = set(multimodal_token_ids_from_config(model.config))
    if any(token in media for token in tokens) or any(
        value != 1 for value in mask.reshape(-1).tolist()
    ):
        return None
    return TextPrefillInput(ids, mask, tokens)
