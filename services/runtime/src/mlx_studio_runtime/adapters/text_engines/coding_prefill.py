"""Advance a Qwen hybrid snapshot at a pre-generation boundary, without trimming GDN state."""

import logging
from dataclasses import dataclass
from typing import Any, cast

from mlx_studio_runtime.adapters.text_engines.coding_cache import MAX_CODING_CACHE_TOKENS
from mlx_studio_runtime.adapters.text_engines.prefix_cache import ExactCacheBackend
from mlx_studio_runtime.domain.context_budget import schema_digest

LOGGER = logging.getLogger(__name__)
PREFILL_CHUNK = 512
PREFIX_GUARD = 16


@dataclass
class PrefillState:
    ids: Any
    tokens: list[int]
    layers: list[Any] | None
    start: int
    boundary: int


def _begin(session: Any, payload: dict[str, Any]) -> bool:
    owner = session.coding_cache
    scope = payload.get("cache_scope")
    config = getattr(session.model, "config", None)
    if (
        not isinstance(scope, str)
        or not scope
        or not payload.get("tools")
        or getattr(config, "model_type", None) != "qwen3_5"
    ):
        owner.clear()
        return False
    from mlx_vlm.apc import APCManager, model_apc_mode  # type: ignore[import-not-found]

    if model_apc_mode(session.model.language_model) != "exact":
        owner.clear()
        return False
    kind = session.drafts.select(coding=True)
    identity = schema_digest(
        [session.model_id, kind, session.processor.tokenizer.chat_template, payload["tools"]]
    )
    try:
        owner.begin(
            scope, identity, lambda: cast(ExactCacheBackend, APCManager(num_blocks=1, disk=None))
        )
    except Exception as error:
        LOGGER.warning("Coding prefix cache unavailable: %s", type(error).__name__)
        owner.clear()
        return False
    return True


def prepare_coding_prefix(session: Any, rendered: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not _begin(session, payload):
        return {}
    from mlx_vlm.utils import (  # type: ignore[import-not-found]
        prepare_inputs,
        should_add_special_tokens,
    )

    owner = session.coding_cache
    inputs = prepare_inputs(
        session.processor,
        prompts=rendered,
        add_special_tokens=should_add_special_tokens(
            session.model.config.model_type, session.processor
        ),
    )
    ids = inputs["input_ids"]
    tokens = ids.reshape(-1).tolist()
    if not PREFIX_GUARD < len(tokens) <= MAX_CODING_CACHE_TOKENS:
        owner.clear()
        return {}
    boundary = len(tokens) - PREFIX_GUARD
    layers, count, features = owner.restore(tokens, boundary)
    draft = session.drafts.dflash if session.drafts.select(coding=True) == "dflash2" else None
    if draft is not None and layers is not None:
        if features is None:
            owner.clear()
            layers, count = None, 0
        else:
            draft.restore_prefix(features)
    return _advance(session, PrefillState(ids, tokens, layers, count, boundary), draft)


def _advance(session: Any, pending: PrefillState, draft: Any) -> dict[str, Any]:
    import mlx.core as mx  # type: ignore[import-not-found]
    from mlx_vlm.generate.common import (  # type: ignore[import-not-found]
        PromptCacheState,
        generation_stream,
    )
    from mlx_vlm.models.cache import make_prompt_cache  # type: ignore[import-not-found]

    layers = pending.layers
    if layers is None:
        layers = make_prompt_cache(session.model.language_model)
    # Only pure text Qwen inputs reach this path. Absolute text positions avoid
    # inheriting mutable mRoPE metadata from the previous request.
    with mx.stream(generation_stream):
        for offset in range(pending.start, pending.boundary, PREFILL_CHUNK):
            if session.cancel.is_set() or session.shutdown.is_set():
                raise ValueError("INFERENCE_CANCELLED")
            end = min(pending.boundary, offset + PREFILL_CHUNK)
            positions = mx.broadcast_to(mx.arange(offset, end)[None, None, :], (3, 1, end - offset))
            session.model.language_model(
                inputs=pending.ids[:, offset:end],
                cache=layers,
                position_ids=positions,
                skip_logits=True,
            )
            mx.eval([layer.state for layer in layers])
            mx.clear_cache()
        features = draft.snapshot_prefix() if draft is not None else None
        session.coding_cache.store(pending.tokens[: pending.boundary], layers, features)
    state = PromptCacheState()
    state.update(pending.tokens[: pending.boundary], layers)
    # Native generation owns this working copy and may mutate it. The retained
    # exact snapshot is independent and never includes speculative suffixes.
    return {"input_ids": pending.ids, "prompt_cache_state": state}
