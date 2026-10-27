"""Audible test tone only; deliberately does not pretend to synthesize speech."""

import math
import struct
import time
from collections.abc import Callable, Iterator


class FakeSpeechEngine:
    def segments(
        self, parameters: dict[str, object], check: Callable[[], None]
    ) -> Iterator[tuple[int, bytes]]:
        rate = 24000
        duration = min(3.0, max(0.5, len(str(parameters["text"])) / 15))
        for part in range(10):
            check()
            time.sleep(0.06)
            count = int(rate * duration / 10)
            yield (
                rate,
                b"".join(
                    struct.pack(
                        "<h", int(6000 * math.sin(2 * math.pi * 220 * (part * count + i) / rate))
                    )
                    for i in range(count)
                ),
            )

    def close(self) -> None:
        return
