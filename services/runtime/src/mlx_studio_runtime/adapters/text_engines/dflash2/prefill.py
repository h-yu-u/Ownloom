"""Request-scoped capture; bounded features and no prefill rollback history."""

# pyright: basic
import mlx.core as mx
from mlx import nn

from mlx_studio_runtime.adapters.text_engines.coding_cache import DraftPrefix


class _CaptureLayer(nn.Module):
    def __init__(self, original, index, owner):
        super().__init__()
        self.original = original
        self.index = index
        # Store the owner outside the parameter tree to avoid a reference cycle.
        object.__setattr__(self, "_capture_owner", owner)

    def __getattr__(self, name):
        try:
            return super().__getattr__(name)
        except AttributeError:
            return getattr(super().__getattr__("original"), name)

    def __call__(self, *args, **kwargs):
        # Prefill never rolls back. Avoid allocating one GDN state per input token.
        kwargs["gdn_sink"] = None
        kwargs["target_verify"] = False
        output = self.original(*args, **kwargs)
        owner = object.__getattribute__(self, "_capture_owner")
        if self.index is not None:
            owner.record(self.index, output)
        return output


class _PrefillFeatures:
    def __init__(self, target, layer_ids, limit):
        self.layers = target.language_model.model.layers
        self.layer_ids = list(layer_ids)
        self.originals = list(self.layers)
        self.hidden: list[mx.array | None] = [None] * len(self.layer_ids)
        self.limit = limit
        self.tokens_seen = 0
        self.finished = False
        for layer_id, original in enumerate(self.originals):
            index = self.layer_ids.index(layer_id) if layer_id in self.layer_ids else None
            self.layers[layer_id] = _CaptureLayer(original, index, self)

    def record(self, index, output):
        if index == 0:
            self.tokens_seen += int(output.shape[1])
        previous = self.hidden[index]
        if previous is not None:
            output = mx.concatenate([previous, output], axis=1)
        self.hidden[index] = mx.contiguous(output[:, -self.limit :])

    def snapshot(self):
        if self.finished or any(h is None for h in self.hidden):
            raise ValueError("DFLASH_PREFIX_INCOMPLETE")
        layers = tuple(mx.array(h) for h in self.hidden if h is not None)
        mx.eval(layers)
        return DraftPrefix(self.tokens_seen, layers)

    def restore(self, snapshot):
        if (
            self.finished
            or self.tokens_seen
            or len(snapshot.layers) != len(self.layer_ids)
            or snapshot.tokens <= 0
            or any(h.shape[1] != min(snapshot.tokens, self.limit) for h in snapshot.layers)
        ):
            raise ValueError("DFLASH_PREFIX_INVALID")
        self.tokens_seen = snapshot.tokens
        self.hidden = [mx.array(h) for h in snapshot.layers]

    def finish(self):
        assert not self.finished and all(h is not None for h in self.hidden)
        hidden = mx.concatenate([h for h in self.hidden if h is not None], axis=-1)
        offset = self.tokens_seen - hidden.shape[1]
        self.close()
        return hidden, offset, self.tokens_seen

    def close(self):
        if self.finished:
            return
        for index, original in enumerate(self.originals):
            self.layers[index] = original
        self.hidden = []
        self.originals = []
        self.finished = True
