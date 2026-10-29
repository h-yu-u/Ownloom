"""Array and cache fixtures for the locked VLM text-prefill boundary."""

import threading
from contextlib import nullcontext
from copy import deepcopy
from types import ModuleType, SimpleNamespace

import numpy as np
from mlx_studio_runtime.adapters.text_engines.coding_cache import CodingPrefixCache
from mlx_studio_runtime.adapters.text_engines.coding_prefill import (
    prepare_coding_prefix,
)


class LayerCache:
    def __init__(self):
        self.offset = 0
        self.state = []
        self.nbytes = 64


class Backend:
    def __init__(self, **_kwargs):
        self.entry = None
        self.stores = []

    def clear(self):
        self.entry = None

    def close(self):
        pass

    def store_exact_cache(self, tokens, layers, **kwargs):
        self.entry = (tuple(tokens), deepcopy(layers), kwargs.get("extra_hash", 0))
        self.stores.append(len(tokens))
        return True

    def lookup_exact_cache(self, tokens, **kwargs):
        if self.entry:
            prefix, layers, salt = self.entry
            if (
                tuple(tokens[: len(prefix)]) == prefix
                and salt == kwargs.get("extra_hash", 0)
                and len(prefix) <= kwargs.get("max_prefix_tokens", len(tokens) - 1)
            ):
                return deepcopy(layers), len(prefix)
        return None, 0


class PromptCacheState:
    def update(self, tokens, layers):
        self.token_ids = tokens
        self.cache = layers


class NativeInputs:
    def __init__(self):
        self.ids = np.arange(100).reshape(1, -1)
        self.mask = np.ones_like(self.ids)
        self.calls = []
        self.cache = CodingPrefixCache()
        self.session = SimpleNamespace(
            coding_cache=self.cache,
            model_id="target",
            processor=SimpleNamespace(tokenizer=SimpleNamespace(chat_template="text")),
            drafts=SimpleNamespace(select=lambda **_: None),
            cancel=threading.Event(),
            shutdown=threading.Event(),
            model=SimpleNamespace(
                config=SimpleNamespace(model_type="qwen3_5"),
                language_model=self.language_model,
            ),
        )

        self.session.processor.apc_key_dependencies = lambda: [
            self.session.processor.tokenizer.chat_template
        ]

    def language_model(self, *, inputs, cache, position_ids, **kwargs):
        self.calls.append((inputs.copy(), position_ids.copy()))
        for layer in cache:
            layer.offset += inputs.shape[1]

    def modules(self):
        result = {}
        for name in (
            "mlx",
            "mlx.core",
            "mlx_vlm.apc",
            "mlx_vlm.utils",
            "mlx_vlm.generate.common",
            "mlx_vlm.models.cache",
        ):
            result[name] = ModuleType(name)
        core = result["mlx.core"]
        result["mlx"].core = core
        core.stream = lambda _: nullcontext()
        core.arange, core.broadcast_to = np.arange, np.broadcast_to
        core.eval = core.clear_cache = lambda *_: None
        apc = result["mlx_vlm.apc"]
        apc.APCManager = Backend
        apc.model_apc_mode = lambda _: "exact"
        apc.multimodal_token_ids_from_config = lambda _: [999999]
        apc.semantic_extra_hash = lambda **kw: hash(
            tuple(kw["processor"].apc_key_dependencies())
        )
        inputs = result["mlx_vlm.utils"]
        inputs.prepare_inputs = lambda *_args, **_kwargs: {
            "input_ids": self.ids,
            "attention_mask": self.mask,
        }
        inputs.should_add_special_tokens = lambda *_: False
        common = result["mlx_vlm.generate.common"]
        common.PromptCacheState = PromptCacheState
        common.generation_stream = None
        result["mlx_vlm.models.cache"].make_prompt_cache = lambda _: [LayerCache()]
        return result

    def prepare(self):
        return prepare_coding_prefix(
            self.session, "rendered", {"cache_scope": "coding:one", "tools": [{}]}
        )
