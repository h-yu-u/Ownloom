"""Advance a validated text prefix without trimming hybrid recurrent state."""

from dataclasses import dataclass
from typing import Any

from mlx_studio_runtime.adapters.text_engines.prefill_inputs import TextPrefillInput

PREFILL_CHUNK = 512


@dataclass(frozen=True)
class PrefillState:
    inputs: TextPrefillInput
    layers: list[Any] | None
    start: int
    boundary: int


def advance_text_prefix(session: Any, pending: PrefillState) -> list[Any]:
    import mlx.core as mx  # type: ignore[import-not-found]
    from mlx_vlm.generate.common import generation_stream  # type: ignore[import-not-found]
    from mlx_vlm.models.cache import make_prompt_cache  # type: ignore[import-not-found]

    if not 0 <= pending.start <= pending.boundary < len(pending.inputs.tokens):
        raise ValueError("PREFIX_BOUNDARY_INVALID")
    layers = pending.layers
    if layers is None:
        layers = make_prompt_cache(session.model.language_model)
    with mx.stream(generation_stream):
        for offset in range(pending.start, pending.boundary, PREFILL_CHUNK):
            if session.cancel.is_set() or session.shutdown.is_set():
                raise ValueError("INFERENCE_CANCELLED")
            end = min(pending.boundary, offset + PREFILL_CHUNK)
            positions = mx.broadcast_to(mx.arange(offset, end)[None, None, :], (3, 1, end - offset))
            session.model.language_model(
                inputs=pending.inputs.ids[:, offset:end],
                cache=layers,
                position_ids=positions,
                skip_logits=True,
            )
            mx.eval([layer.state for layer in layers])
            mx.clear_cache()
    return layers


def native_prefix_options(
    inputs: TextPrefillInput, layers: list[Any], boundary: int
) -> dict[str, Any]:
    from mlx_vlm.generate.common import PromptCacheState  # type: ignore[import-not-found]

    state = PromptCacheState()
    state.update(inputs.tokens[:boundary], layers)
    return inputs.native_options(state)
