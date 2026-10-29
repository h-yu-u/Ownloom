"""Request timings measured in the Worker, alongside unchanged native engine rates."""

import time
from collections.abc import Callable, Mapping
from typing import Protocol

from mlx_studio_runtime.adapters.text_engines.generation_stats import native_generation_stats
from mlx_studio_runtime.domain.generation_stats import DraftMode, GenerationStats


class PrefixMeasurements(Protocol):
    @property
    def prompt_tokens(self) -> int | None: ...

    @property
    def cached_tokens(self) -> int | None: ...


class GenerationMeasurements:
    def __init__(self, clock: Callable[[], float] = time.perf_counter) -> None:
        self.clock = clock
        self.started: float | None = None
        self.first_native: float | None = None
        self.first_text: float | None = None
        self.ended: float | None = None
        self.mode: DraftMode = "none"
        self.native: GenerationStats | None = None

    def begin(self) -> None:
        self.started = self.clock()
        self.first_native = self.first_text = self.ended = None
        self.mode = "none"
        self.native = None

    def draft(self, options: Mapping[str, object]) -> None:
        kind = options.get("draft_kind") if options.get("draft_model") is not None else None
        self.mode = "dflash2" if kind == "dflash" else "mtp" if kind == "mtp" else "none"

    def observe(self, engine: str, response: object) -> None:
        self.native = native_generation_stats(engine, response)
        token = getattr(response, "token", None)
        count = getattr(response, "generation_tokens", None)
        has_token = isinstance(token, int) and not isinstance(token, bool) and token >= 0
        has_count = isinstance(count, int) and not isinstance(count, bool) and count > 0
        if self.first_native is None and (has_token or has_count):
            self.first_native = self.clock()

    def visible_text(self, text: str) -> None:
        if text and self.first_text is None:
            self.first_text = self.clock()

    def finish(self) -> None:
        self.ended = self.clock()

    def result(self, prefix: PrefixMeasurements) -> GenerationStats | None:
        if self.native is None or self.started is None:
            return None
        stats = self.native.copy()
        # Native cached_tokens can include manual prefill performed in THIS request.
        # Only the owner knows how much state was actually reused from a prior request.
        if prefix.prompt_tokens is not None:
            stats["promptTokens"] = prefix.prompt_tokens
        if prefix.cached_tokens is not None:
            stats["cachedTokens"] = prefix.cached_tokens
        total, cached = stats["promptTokens"], stats["cachedTokens"]
        stats.update(
            draftMode=self.mode,
            prefillTokens=total - cached
            if total is not None and cached is not None and cached <= total
            else None,
            prefillMs=self._elapsed(self.first_native),
            firstTokenMs=self._elapsed(self.first_text),
            durationMs=self._elapsed(self.ended),
        )
        return stats

    def _elapsed(self, end: float | None) -> float | None:
        if self.started is None or end is None:
            return None
        return max(0.0, end - self.started) * 1000
