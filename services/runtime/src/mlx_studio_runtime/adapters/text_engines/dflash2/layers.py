# Copyright (c) 2026 Z Lab. MIT; see LICENSE in this directory.
# Adapted from z-lab/dflash@07ebd93db9f472af339b644bb70221ad8428328a/model_mlx.py.
# Network/selector math retained; target generation and remote loading excluded.
# pyright: basic
import mlx.core as mx
from mlx import nn
from mlx_lm.models.base import create_causal_mask
from mlx_lm.models.qwen3 import MLP

from mlx_studio_runtime.adapters.text_engines.dflash2.config import DFlashConfig


class DFlashAttention(nn.Module):
    def __init__(self, config: DFlashConfig, layer_idx: int):
        super().__init__()
        dim = config.hidden_size
        self.n_heads = n_heads = config.num_attention_heads
        self.n_kv_heads = n_kv_heads = config.num_key_value_heads
        self.scale = config.head_dim**-0.5
        self.is_sliding = config.layer_types[layer_idx] == "sliding_attention"
        self.sliding_window = config.sliding_window if self.is_sliding else None
        self.is_causal = self.is_sliding if config.is_causal is None else config.is_causal
        self.q_proj = nn.Linear(dim, n_heads * config.head_dim, bias=False)
        self.k_proj = nn.Linear(dim, n_kv_heads * config.head_dim, bias=False)
        self.v_proj = nn.Linear(dim, n_kv_heads * config.head_dim, bias=False)
        self.o_proj = nn.Linear(n_heads * config.head_dim, dim, bias=False)
        self.q_norm = nn.RMSNorm(config.head_dim, eps=config.rms_norm_eps)
        self.k_norm = nn.RMSNorm(config.head_dim, eps=config.rms_norm_eps)

    def __call__(self, x, x_ctx, rope, cache):
        B, L, _ = x.shape
        S = x_ctx.shape[1]
        if self.is_sliding:
            if self.sliding_window is None:
                raise ValueError("DFLASH_WINDOW_REQUIRED")
            keep_ctx = self.sliding_window - 1
            if S > keep_ctx:
                skip = S - keep_ctx
                x_ctx = x_ctx[:, skip:]
                S = x_ctx.shape[1]
                cache.offset += skip
        queries = self.q_proj(x)
        ctx_keys = self.k_proj(x_ctx)
        ctx_values = self.v_proj(x_ctx)
        prop_keys = self.k_proj(x)
        prop_values = self.v_proj(x)
        queries = self.q_norm(queries.reshape(B, L, self.n_heads, -1)).transpose(0, 2, 1, 3)
        ctx_keys = self.k_norm(ctx_keys.reshape(B, S, self.n_kv_heads, -1)).transpose(0, 2, 1, 3)
        ctx_values = ctx_values.reshape(B, S, self.n_kv_heads, -1).transpose(0, 2, 1, 3)
        prop_keys = self.k_norm(prop_keys.reshape(B, L, self.n_kv_heads, -1)).transpose(0, 2, 1, 3)
        prop_values = prop_values.reshape(B, L, self.n_kv_heads, -1).transpose(0, 2, 1, 3)
        queries = rope(queries, offset=cache.offset + S)
        ctx_keys = rope(ctx_keys, offset=cache.offset)
        prop_keys = rope(prop_keys, offset=cache.offset + S)
        keys, values = cache.update_and_fetch(ctx_keys, ctx_values)
        ctx_len = keys.shape[2]
        keys = mx.concatenate([keys, prop_keys], axis=2)
        values = mx.concatenate([values, prop_values], axis=2)
        mask = create_causal_mask(L, offset=ctx_len) if self.is_causal else None
        if self.is_sliding:
            query = ctx_len + mx.arange(L)[:, None]
            key = mx.arange(ctx_len + L)[None]
            context = (key < ctx_len) & (query - key < self.sliding_window)
            block = key >= ctx_len
            if self.is_causal:
                block = block & (key <= query)
            mask = context | block
        output = mx.fast.scaled_dot_product_attention(
            queries, keys, values, scale=self.scale, mask=mask
        )
        return self.o_proj(output.transpose(0, 2, 1, 3).reshape(B, L, -1))


class DFlashDecoderLayer(nn.Module):
    def __init__(self, config: DFlashConfig, layer_idx: int):
        super().__init__()
        self.self_attn = DFlashAttention(config, layer_idx)
        self.mlp = MLP(config.hidden_size, config.intermediate_size)
        self.input_layernorm = nn.RMSNorm(config.hidden_size, eps=config.rms_norm_eps)
        self.post_attention_layernorm = nn.RMSNorm(config.hidden_size, eps=config.rms_norm_eps)

    def __call__(self, x, x_ctx, rope, cache):
        h = x + self.self_attn(self.input_layernorm(x), x_ctx, rope, cache)
        return h + self.mlp(self.post_attention_layernorm(h))


def _grouped_dynamic_convolve(hidden, dynamic, base, group_size):
    batch, length, hidden_size = hidden.shape
    groups = hidden_size // group_size
    blocks = hidden.reshape(batch, length, groups, group_size)
    dynamic = dynamic.reshape(batch, length, base.shape[0], groups, 1)
    output = mx.zeros_like(blocks)
    for offset in range(base.shape[0]):
        values = (
            blocks
            if offset == 0
            else mx.concatenate([mx.zeros_like(blocks[:, :offset]), blocks[:, :-offset]], axis=1)
        )
        kernel = base[offset].reshape(1, 1, groups, group_size).astype(hidden.dtype)
        output = output + kernel * values
        output = output + dynamic[:, :, offset] * values
    return output.reshape(hidden.shape)


class GroupedDynamicCausalConv(nn.Module):
    def __init__(self, hidden_size, kernel_size, group_size):
        super().__init__()
        self.kernel_size = kernel_size
        self.group_size = group_size
        groups = hidden_size // group_size
        self.base_kernel = mx.zeros((2, kernel_size, hidden_size))
        self.kernel_projection = nn.Linear(hidden_size, 2 * kernel_size * groups, bias=False)

    def prepare(self, hidden):
        groups = hidden.shape[-1] // self.group_size
        dynamic = self.kernel_projection(hidden).reshape(
            *hidden.shape[:-1], 2, self.kernel_size, groups
        )
        return (
            _grouped_dynamic_convolve(
                hidden, dynamic[..., 0, :, :], self.base_kernel[0], self.group_size
            ),
            dynamic[..., 1, :, :],
        )

    def finish(self, hidden, dynamic):
        return _grouped_dynamic_convolve(hidden, dynamic, self.base_kernel[1], self.group_size)


class DFlash2DecoderLayer(DFlashDecoderLayer):
    def __init__(self, config: DFlashConfig, layer_idx: int):
        super().__init__(config, layer_idx)
        self.attention_conv = GroupedDynamicCausalConv(
            config.hidden_size, config.conv_kernel_size, config.conv_group_size
        )
        self.mlp_conv = GroupedDynamicCausalConv(
            config.hidden_size, config.conv_kernel_size, config.conv_group_size
        )

    def __call__(self, x, x_ctx, rope, cache):
        residual = x
        x, kernel = self.attention_conv.prepare(self.input_layernorm(x))
        x = residual + self.attention_conv.finish(self.self_attn(x, x_ctx, rope, cache), kernel)
        residual = x
        x, kernel = self.mlp_conv.prepare(self.post_attention_layernorm(x))
        return residual + self.mlp_conv.finish(self.mlp(x), kernel)
