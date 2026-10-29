"""Advance a Qwen hybrid snapshot at a pre-generation boundary, without trimming GDN state."""

import logging
from typing import Any, cast

from mlx_studio_runtime.adapters.text_engines.coding_cache import MAX_CODING_CACHE_TOKENS
from mlx_studio_runtime.adapters.text_engines.prefill_inputs import prepare_text_input
from mlx_studio_runtime.adapters.text_engines.prefix_cache import ExactCacheBackend
from mlx_studio_runtime.adapters.text_engines.prefix_prefill import (
    PrefillState,
    advance_text_prefix,
    native_prefix_options,
)
from mlx_studio_runtime.domain.context_budget import schema_digest

LOGGER = logging.getLogger(__name__)
PREFIX_GUARD = 16


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
    owner = session.coding_cache
    inputs = prepare_text_input(session.model, session.processor, rendered)
    if inputs is None:
        owner.clear()
        return {}
    tokens = inputs.tokens
    owner.prompt_tokens = len(tokens)
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
    return _advance(session, PrefillState(inputs, layers, count, boundary), draft)


def _advance(session: Any, pending: PrefillState, draft: Any) -> dict[str, Any]:
    import mlx.core as mx  # type: ignore[import-not-found]
    from mlx_vlm.generate.common import generation_stream  # type: ignore[import-not-found]

    layers = advance_text_prefix(session, pending)
    with mx.stream(generation_stream):
        features = draft.snapshot_prefix() if draft is not None else None
        session.coding_cache.store(pending.inputs.tokens[: pending.boundary], layers, features)
    # Native generation owns this working copy and may mutate it. The retained
    # exact snapshot is independent and never includes speculative suffixes.
    return native_prefix_options(pending.inputs, layers, pending.boundary)
