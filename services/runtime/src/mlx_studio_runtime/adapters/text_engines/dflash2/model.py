# Copyright (c) 2026 Z Lab. MIT; see LICENSE in this directory.
# Adapted from z-lab/dflash@07ebd93db9f472af339b644bb70221ad8428328a/model_mlx.py.
# Network/selector math retained; target generation and remote loading excluded.
# pyright: basic
from typing import Any

import mlx.core as mx  # type: ignore[import-not-found]
from mlx import nn  # type: ignore[import-not-found]
from mlx_lm.models.cache import KVCache, RotatingKVCache  # type: ignore[import-not-found]
from mlx_lm.models.rope_utils import initialize_rope  # type: ignore[import-not-found]

from mlx_studio_runtime.adapters.text_engines.dflash2.config import DFlashConfig
from mlx_studio_runtime.adapters.text_engines.dflash2.layers import (
    DFlash2DecoderLayer,
    DFlashDecoderLayer,
)


def _sampling_probs(logits, temperature, top_p=1.0, top_k=0):
    scores = logits.astype(mx.float32) / temperature
    vocab_size = scores.shape[-1]
    if 0 < top_k < vocab_size:
        indices = mx.argpartition(-scores, top_k - 1, axis=-1)[..., :top_k]
        scores = mx.take_along_axis(scores, indices, axis=-1)
    else:
        indices = None

    probs = mx.softmax(scores, axis=-1)
    if top_p < 1.0:
        order = mx.argsort(-probs, axis=-1)
        sorted_probs = mx.take_along_axis(probs, order, axis=-1)
        keep = mx.cumsum(sorted_probs, axis=-1) - sorted_probs < top_p
        sorted_probs = mx.where(keep, sorted_probs, 0)
        probs = mx.put_along_axis(mx.zeros_like(probs), order, sorted_probs, axis=-1)
        probs = probs / mx.sum(probs, axis=-1, keepdims=True)

    if indices is not None:
        probs = mx.put_along_axis(
            mx.zeros(logits.shape, dtype=probs.dtype), indices, probs, axis=-1
        )
    return probs


def _sample_probs(probs):
    return mx.random.categorical(mx.log(probs))


def _sample_logits(logits, temperature=0.0, top_p=1.0, top_k=0):
    if temperature <= 0:
        return mx.argmax(logits, axis=-1)
    return _sample_probs(_sampling_probs(logits, temperature, top_p, top_k))


def make_sampler(temperature=0.0, top_p=1.0, top_k=0):
    if temperature < 0 or not 0 < top_p <= 1 or top_k < 0:
        raise ValueError("temperature and top_k must be non-negative, and top_p in (0, 1].")
    return lambda logits: _sample_logits(logits, temperature, top_p, top_k)


def _build_rope(
    head_dim: int,
    rope_theta: float,
    max_position_embeddings: int,
    rope_scaling: dict[str, Any] | None,
):
    return initialize_rope(
        dims=head_dim,
        base=rope_theta,
        traditional=False,
        scaling_config=rope_scaling,
        max_position_embeddings=max_position_embeddings,
    )


class CandidateSelector(nn.Module):
    def __init__(self, config: DFlashConfig):
        super().__init__()
        self.top_k = config.selector_top_k
        self.predecessor_codebook = nn.Embedding(config.vocab_size, config.selector_rank)
        self.successor_codebook = nn.Embedding(config.vocab_size, config.selector_rank)
        self.hidden_projection = nn.Linear(config.hidden_size, config.selector_rank, bias=False)

    def select(self, hidden, logits, anchor_ids, temperature):
        candidates = mx.argpartition(logits, -self.top_k, axis=-1)[..., -self.top_k :]
        unary = mx.take_along_axis(logits, candidates, axis=-1)
        hidden = self.hidden_projection(hidden)
        predecessor = anchor_ids
        path, q_rows = [], []
        for position in range(hidden.shape[1]):
            edges = mx.sum(
                self.predecessor_codebook(predecessor)[:, None]
                * hidden[:, position, None]
                * self.successor_codebook(candidates[:, position]),
                axis=-1,
            )
            scores = unary[:, position] + edges
            if temperature > 0:
                q = _sampling_probs(scores[:, None], temperature)[:, 0]
                selected = _sample_probs(q)
                q_rows.append(q)
            else:
                selected = mx.argmax(scores, axis=-1)
            predecessor = mx.take_along_axis(candidates[:, position], selected[:, None], axis=-1)[
                :, 0
            ]
            path.append(predecessor)
        return (
            mx.stack(path, axis=1),
            candidates,
            mx.stack(q_rows, axis=1) if q_rows else None,
        )


class DFlashDraftModel(nn.Module):
    layer_class = DFlashDecoderLayer

    def __init__(self, config: DFlashConfig):
        super().__init__()
        self.config = config
        if not self.config.layer_types:
            self.config.layer_types = ("full_attention",) * self.config.num_hidden_layers
        concat_dim = len(config.target_layer_ids) * config.hidden_size
        self.fc = nn.Linear(concat_dim, config.hidden_size, bias=False)
        self.hidden_norm = nn.RMSNorm(config.hidden_size, eps=config.rms_norm_eps)
        self.layers = [self.layer_class(config, i) for i in range(config.num_hidden_layers)]
        self.norm = nn.RMSNorm(config.hidden_size, eps=config.rms_norm_eps)
        self.rope = _build_rope(
            config.head_dim,
            config.rope_theta,
            config.max_position_embeddings,
            config.rope_scaling,
        )
        self.embed_tokens: Any = None
        self.lm_head: Any = None
        self.embed_scale = 1.0

    def bind(self, target_model):
        if hasattr(target_model, "embed_tokens"):
            inner = target_model
        elif hasattr(target_model, "model") and hasattr(target_model.model, "embed_tokens"):
            inner = target_model.model
        elif (
            hasattr(target_model, "language_model")
            and hasattr(target_model.language_model, "model")
            and hasattr(target_model.language_model.model, "embed_tokens")
        ):
            inner = target_model.language_model.model
        else:
            raise AttributeError(f"Cannot find embed_tokens in {type(target_model).__name__}")
        self.embed_tokens = inner.embed_tokens
        self.embed_scale = (
            getattr(self.embed_tokens, "embed_scale", getattr(inner, "embed_scale", 1.0))
            * self.config.input_embedding_scale
        )
        lm = getattr(target_model, "language_model", target_model)
        self.lm_head = (
            getattr(target_model, "lm_head", None)
            or getattr(lm, "lm_head", None)
            or self.embed_tokens.as_linear
        )
        return self

    def make_cache(self):
        caches = []
        for layer_type in self.config.layer_types:
            if layer_type == "sliding_attention":
                if self.config.sliding_window is None:
                    raise ValueError(
                        "Draft config must define sliding_window for sliding_attention layers."
                    )
                caches.append(RotatingKVCache(max_size=self.config.sliding_window - 1, keep=0))
            else:
                caches.append(KVCache())
        return caches

    def hidden_states(
        self,
        inputs,
        target_hidden,
        cache,
        logits_start: int = 0,
    ):
        h = self.embed_tokens(inputs) * self.embed_scale
        h_ctx = self.hidden_norm(self.fc(target_hidden))
        for layer, c in zip(self.layers, cache, strict=True):
            h = layer(h, h_ctx, self.rope, c)
        if logits_start:
            h = h[:, logits_start:]
        return self.norm(h)

    def __call__(self, inputs, target_hidden, cache, logits_start: int = 0):
        return self.compute_logits(self.hidden_states(inputs, target_hidden, cache, logits_start))

    def compute_logits(self, hidden):
        logits = self.lm_head(hidden)
        logits = logits * self.config.output_multiplier
        if (
            self.config.final_logit_softcapping is not None
            and self.config.final_logit_softcapping > 0
        ):
            cap = self.config.final_logit_softcapping
            logits = mx.tanh(logits / cap) * cap
        return logits


class DFlash2DraftModel(DFlashDraftModel):
    layer_class = DFlash2DecoderLayer

    def __init__(self, config: DFlashConfig):
        super().__init__(config)
        self.candidate_selector = CandidateSelector(config)

    def propose(self, inputs, target_hidden, cache, temperature, logits_start: int = 0):
        hidden = self.hidden_states(inputs, target_hidden, cache, logits_start)
        return self.candidate_selector.select(
            hidden, self.compute_logits(hidden), inputs[:, 0], temperature
        )
