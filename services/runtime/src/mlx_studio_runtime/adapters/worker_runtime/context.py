"""Neutral cancellation, event and device policy shared by every worker driver."""

import gc
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class WorkerContext:
    emit: Callable[[str, dict[str, Any]], None]
    cancel: threading.Event = field(default_factory=threading.Event)
    shutdown: threading.Event = field(default_factory=threading.Event)

    @property
    def signals(self) -> tuple[threading.Event, threading.Event]:
        return self.cancel, self.shutdown

    def configure_device(self, engine: str) -> None:
        if engine == "fake":
            return
        import mlx.core as mx  # type: ignore[import-not-found]

        # MLX 0.32.1 compiled-cache teardown can segfault after Qwen inference.
        # Keep this compatibility policy until model/exit/long-running revalidation.
        mx.disable_compile()
        mx.set_cache_limit(4 * 1024**3)

    def release_device(self, engine: str) -> None:
        if engine == "fake":
            return
        import mlx.core as mx  # type: ignore[import-not-found]

        mx.synchronize()
        gc.collect()
        mx.clear_cache()
