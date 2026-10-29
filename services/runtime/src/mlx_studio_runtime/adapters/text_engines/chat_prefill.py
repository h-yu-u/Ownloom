"""Advance stable Qwen chat checkpoints while retaining native cold fallbacks."""

import logging
from typing import Any

from mlx_studio_runtime.adapters.text_engines.prefill_inputs import prepare_text_input
from mlx_studio_runtime.adapters.text_engines.prefix_cache import MAX_PREFIX_TOKENS
from mlx_studio_runtime.adapters.text_engines.prefix_prefill import (
    PrefillState,
    advance_text_prefix,
    native_prefix_options,
)

LOGGER = logging.getLogger(__name__)
ADVANCE_PREFIX_TOKENS = 512
MIN_PREFIX_TOKENS = 16


def checkpoint_boundary(tokens: int, guard: int, reused: int = 0) -> int:
    desired = min(MAX_PREFIX_TOKENS, max(0, tokens - guard))
    if reused and desired < MAX_PREFIX_TOKENS and desired - reused < ADVANCE_PREFIX_TOKENS:
        return reused
    return desired


def prepare_chat_prefix(session: Any, rendered: str) -> dict[str, Any]:
    owner = session.prefix_cache
    options = dict(owner.options)
    cache = options.get("apc_manager")
    config = getattr(session.model, "config", None)
    if cache is None or getattr(config, "model_type", None) != "qwen3_5":
        return options
    try:
        from mlx_vlm.apc import semantic_extra_hash  # type: ignore[import-not-found]

        inputs = prepare_text_input(session.model, session.processor, rendered)
        if inputs is None:
            owner.clear()
            return {}
        boundary = checkpoint_boundary(len(inputs.tokens), cache.exact_cache_guard_tokens)
        if boundary < MIN_PREFIX_TOKENS:
            owner.clear()
            return {}
        salt = semantic_extra_hash(
            tenant=options.get("apc_tenant"), model=session.model, processor=session.processor
        )
        layers, count = cache.lookup_exact_cache(
            inputs.tokens, extra_hash=salt, max_prefix_tokens=boundary
        )
        if cache.failed:
            owner.clear()
            return {}
    except Exception as error:  # Optional preparation; native cold input is still safe.
        LOGGER.warning("Chat prefix preparation unavailable: %s", type(error).__name__)
        owner.clear()
        return {}
    boundary = checkpoint_boundary(len(inputs.tokens), cache.exact_cache_guard_tokens, count)
    if layers is None or boundary > count:
        layers = advance_text_prefix(session, PrefillState(inputs, layers, count, boundary))
        cache.store_exact_cache(inputs.tokens[:boundary], layers, extra_hash=salt)
    # This working copy may contain input evaluated in THIS request. The owner's
    # cached_tokens retains only count restored from a previous request.
    return native_prefix_options(inputs, layers, boundary)
