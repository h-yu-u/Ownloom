"""One bounded exact prefix, including recurrent state and optional draft features."""

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from mlx_studio_runtime.adapters.text_engines.prefix_cache import ExactCacheBackend, snapshot_bytes

LOGGER = logging.getLogger(__name__)
MAX_CODING_CACHE_TOKENS = 32768
MAX_CODING_CACHE_BYTES = 2 * 1024**3


@dataclass(frozen=True)
class DraftPrefix:
    tokens: int
    layers: tuple[Any, ...]


class CodingPrefixCache:
    def __init__(self) -> None:
        self._key: tuple[str, str] | None = None
        self._backend: ExactCacheBackend | None = None
        self._features: DraftPrefix | None = None
        self.cached_tokens = 0
        self.prompt_tokens: int | None = None
        self.retained_tokens = 0
        self.retained_bytes = 0

    def begin(self, scope: str, identity: str, factory: Callable[[], ExactCacheBackend]) -> None:
        key = (scope, identity)
        if key != self._key:
            self.clear()
        self.cached_tokens = 0
        self.prompt_tokens = None
        if self._backend is None:
            self._backend = factory()
        self._key = key

    def restore(
        self, tokens: Sequence[int], boundary: int
    ) -> tuple[list[Any] | None, int, DraftPrefix | None]:
        if self._backend is None:
            return None, 0, None
        try:
            layers, count = self._backend.lookup_exact_cache(tokens, max_prefix_tokens=boundary)
            if layers is None or count != self.retained_tokens or count <= 0:
                return None, 0, None
            if self._features is not None and self._features.tokens != count:
                self.clear()
                return None, 0, None
            self.cached_tokens = count
            return layers, count, self._features
        except Exception as error:  # Optional snapshot IO; cold prefill remains available.
            self._failed(error)
            return None, 0, None

    def store(
        self, tokens: Sequence[int], layers: Sequence[Any], features: DraftPrefix | None
    ) -> bool:
        if self._backend is None:
            return False
        try:
            self._backend.clear()
            self._features = None
            self.retained_tokens = self.retained_bytes = 0
            size = snapshot_bytes([*layers, *(features.layers if features else ())])
            if (
                not 0 < len(tokens) <= MAX_CODING_CACHE_TOKENS
                or size is None
                or size > MAX_CODING_CACHE_BYTES
                or (features is not None and features.tokens != len(tokens))
            ):
                return False
            if not self._backend.store_exact_cache(tokens, layers):
                return False
            self._features = features
            self.retained_tokens, self.retained_bytes = len(tokens), size
            return True
        except Exception as error:
            # The request may still generate from its valid working prefix.
            # Releasing a failed retained snapshot must not erase actual reuse.
            self._failed(error, preserve_measurements=True)
            return False

    def finish(self, completed: bool) -> None:
        if not completed:
            self.clear()

    def _failed(self, error: Exception, *, preserve_measurements: bool = False) -> None:
        LOGGER.warning("Coding prefix cache disabled: %s", type(error).__name__)
        cached, prompt = self.cached_tokens, self.prompt_tokens
        self.clear()
        if preserve_measurements:
            self.cached_tokens, self.prompt_tokens = cached, prompt

    def clear(self) -> None:
        backend, self._backend = self._backend, None
        self._key = self._features = None
        self.cached_tokens = self.retained_tokens = self.retained_bytes = 0
        self.prompt_tokens = None
        if backend is not None:
            try:
                backend.clear()
            except Exception as error:
                LOGGER.warning("Coding prefix clear failed: %s", type(error).__name__)
            try:
                backend.close()
            except Exception as error:
                LOGGER.warning("Coding prefix close failed: %s", type(error).__name__)
