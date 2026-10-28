"""Bounded, memory-only APC snapshots owned by one ordinary chat session."""

import logging
from collections.abc import Sequence
from typing import Any, Protocol, TypedDict, cast

LOGGER = logging.getLogger(__name__)
MAX_PREFIX_TOKENS = 8192
MAX_SNAPSHOT_BYTES = 1024**3


def snapshot_bytes(layers: Sequence[Any]) -> int | None:
    total = 0
    for layer in layers:
        size: object = getattr(layer, "nbytes", None)
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            return None
        total += size
    return total if layers else None


class ExactCacheBackend(Protocol):
    exact_cache_guard_tokens: int

    def store_exact_cache(
        self, token_ids: Sequence[int], prompt_cache: Sequence[Any], *, extra_hash: int = 0
    ) -> bool: ...
    def lookup_exact_cache(
        self, token_ids: Sequence[int], **kwargs: Any
    ) -> tuple[list[Any] | None, int]: ...
    def clear(self) -> None: ...
    def close(self) -> None: ...


class BoundedExactCache:
    """Keep only the first prefill checkpoint, including hybrid recurrent state.

    The upstream callback stores a guarded prefix before the final prompt token,
    then offers the whole prompt. Retaining the guarded snapshot allows identical
    prompts (regeneration) to hit without trimming non-trimmable ArraysCache.
    """

    def __init__(self, backend: ExactCacheBackend) -> None:
        self.backend = backend
        self.exact_cache_guard_tokens = 16
        self.failed = False
        self._stored = False

    def begin(self) -> None:
        self._stored = False
        self.exact_cache_guard_tokens = 16

    def store_exact_cache(
        self, token_ids: Sequence[int], prompt_cache: Sequence[Any], *, extra_hash: int = 0
    ) -> bool:
        if self.failed or self._stored:
            return False
        try:
            size = snapshot_bytes(prompt_cache)
            self.backend.clear()
            if (
                not 0 < len(token_ids) <= MAX_PREFIX_TOKENS
                or size is None
                or size > MAX_SNAPSHOT_BYTES
            ):
                return False
            self._stored = self.backend.store_exact_cache(
                token_ids, prompt_cache, extra_hash=extra_hash
            )
            return self._stored
        except Exception as error:  # Optional cache boundary; generation remains cold-capable.
            self._invalidate(error)
            return False

    def lookup_exact_cache(
        self, token_ids: Sequence[int], **kwargs: Any
    ) -> tuple[list[Any] | None, int]:
        if self.failed:
            return None, 0
        try:
            if len(token_ids) > MAX_PREFIX_TOKENS:
                self.backend.clear()
                return None, 0
            return self.backend.lookup_exact_cache(token_ids, **kwargs)
        except Exception as error:
            self._invalidate(error)
            return None, 0

    def _invalidate(self, error: Exception) -> None:
        self.failed = True
        LOGGER.warning("Chat prefix cache disabled: %s", type(error).__name__)
        self.close()

    def close(self) -> None:
        try:
            self.backend.clear()
        except Exception as error:
            LOGGER.warning("Chat prefix cache clear failed: %s", type(error).__name__)
        finally:
            try:
                self.backend.close()
            except Exception as error:
                LOGGER.warning("Chat prefix cache close failed: %s", type(error).__name__)


def create_exact_cache(model: Any) -> BoundedExactCache | None:
    from mlx_vlm.apc import APCManager, model_apc_mode  # type: ignore[import-not-found]

    if model_apc_mode(model.language_model) != "exact":
        return None
    # No disk store; block-mode models are deliberately excluded above.
    return BoundedExactCache(cast(ExactCacheBackend, APCManager(num_blocks=1, disk=None)))


class CacheOptions(TypedDict, total=False):
    apc_manager: BoundedExactCache
    apc_tenant: str


class ChatPrefixCache:
    def __init__(self) -> None:
        self.options: CacheOptions = {}
        self.suffix = ""
        self._conversation_id: str | None = None
        self._cache: BoundedExactCache | None = None

    def begin(self, model: Any, engine: str, payload: dict[str, Any]) -> None:
        conversation = payload.get("conversation_id")
        if (
            engine != "mlx-vlm"
            or not isinstance(conversation, str)
            or not 0 < len(conversation) <= 128
            or payload.get("image_paths")
        ):
            self.clear()
            return
        if conversation != self._conversation_id:
            self.clear()
        if self._cache is None:
            try:
                self._cache = create_exact_cache(model)
            except Exception as error:
                LOGGER.warning("Chat prefix cache unavailable: %s", type(error).__name__)
                return
        if self._cache is not None:
            self._conversation_id = conversation
            self._cache.begin()
            suffix = payload.get("cache_suffix", "")
            self.suffix = suffix if isinstance(suffix, str) else ""
            self.options = {"apc_manager": self._cache, "apc_tenant": conversation}

    def guard_suffix(self, full: Sequence[int], stable: Sequence[int]) -> None:
        common = 0
        for left, right in zip(full, stable, strict=False):
            if left != right:
                break
            common += 1
        if self._cache is not None:
            # Leave a small token boundary margin as well as the volatile time.
            self._cache.exact_cache_guard_tokens = max(16, len(full) - common + 8)

    def finish(self, completed: bool) -> None:
        self.options = {}
        self.suffix = ""
        if not completed or (self._cache is not None and self._cache.failed):
            self.clear()

    def clear(self) -> None:
        cache, self._cache = self._cache, None
        self.options = {}
        self.suffix = ""
        self._conversation_id = None
        if cache is not None:
            cache.close()
