"""DFlash2 proposals using the same VLM target, sampler and rollback as MTP."""

# pyright: basic
import mlx.core as mx  # type: ignore[import-not-found]
from mlx import nn  # type: ignore[import-not-found]
from mlx_vlm.speculative.common import generation_stream  # type: ignore[import-not-found]

from mlx_studio_runtime.adapters.text_engines.dflash2.prefill import (
    _PrefillFeatures as PrefillFeatures,
)


class DFlash2Bridge(nn.Module):
    prefer_requested_block_size = True

    def __init__(self, core):
        super().__init__()
        self.core = core
        self.config = core.config
        self.accept_lens = []
        self.draft_lens = []
        self.propose_calls_total = 0
        object.__setattr__(self, "_capture", None)
        self._pending_hidden = None
        self.prefill_capture = {}

    def validate_target_compatibility(self, target):
        lm = target.language_model
        if (
            lm.args.hidden_size != self.config.hidden_size
            or lm.args.vocab_size != self.config.vocab_size
            or len(lm.model.layers) != self.config.num_target_layers
            or not all(0 <= i < len(lm.model.layers) for i in self.config.target_layer_ids)
            or not callable(getattr(lm, "rollback_speculative_cache", None))
        ):
            raise ValueError("DFLASH_TARGET_MISMATCH")

    def bind(self, target):
        self.validate_target_compatibility(target)
        self.core.bind(target)
        return self

    def make_cache(self):
        return self.core.make_cache()

    def begin_request(self, target):
        self.end_request()
        capture = PrefillFeatures(
            target, self.config.target_layer_ids, self.config.sliding_window - 1
        )
        object.__setattr__(self, "_capture", capture)

    def end_request(self):
        capture = object.__getattribute__(self, "_capture")
        if capture is not None:
            capture.close()
            object.__setattr__(self, "_capture", None)
        self._pending_hidden = None

    def snapshot_prefix(self):
        capture = object.__getattribute__(self, "_capture")
        if capture is None:
            raise ValueError("DFLASH_PREFIX_UNAVAILABLE")
        return capture.snapshot()

    def restore_prefix(self, snapshot):
        capture = object.__getattribute__(self, "_capture")
        if capture is None:
            raise ValueError("DFLASH_PREFIX_UNAVAILABLE")
        capture.restore(snapshot)

    def reset(self, target):
        self.bind(target)
        self.accept_lens = []
        self.draft_lens = []
        caches = self.make_cache()
        capture = object.__getattribute__(self, "_capture")
        if capture is not None:
            hidden, offset, count = capture.finish()
            object.__setattr__(self, "_capture", None)
            self._pending_hidden = hidden
            for item in caches:
                item.offset = offset
            self.prefill_capture = {
                "tokens_seen": count,
                "retained_tokens": int(hidden.shape[1]),
                "offset": int(offset),
            }
        return caches

    def draft_block(self, last_bonus, hidden, cache, block_size, sampler, token_dtype=mx.int32):
        # Proposals are deterministic. VLM samples the TARGET at the requested
        # temperature and accepts only its matching prefix; proposals never emit
        # without target verification. Do not consume the target sampler here.
        del sampler
        if not isinstance(last_bonus, int) or hidden.shape[0] != 1 or not 2 <= block_size <= 5:
            raise ValueError("DFLASH_REQUEST_UNSUPPORTED")
        with mx.stream(generation_stream):
            if self._pending_hidden is not None:
                hidden = self._pending_hidden
                self._pending_hidden = None
            # Match official prefill's sliding context limit and absolute offsets.
            if cache[0].offset == 0 and hidden.shape[1] > self.config.sliding_window - 1:
                skip = hidden.shape[1] - (self.config.sliding_window - 1)
                hidden = hidden[:, skip:]
                for item in cache:
                    item.offset = skip
            block = mx.array(
                [[last_bonus] + [self.config.mask_token_id] * (block_size - 1)], dtype=token_dtype
            )
            tokens, _, _ = self.core.propose(block, hidden, cache, temperature=0, logits_start=1)
        self.propose_calls_total += 1
        return tokens

    def close(self):
        self.end_request()
        self.core.embed_tokens = None
        self.core.lm_head = None
