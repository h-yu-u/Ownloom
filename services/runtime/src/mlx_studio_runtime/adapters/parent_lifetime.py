"""Desktop pipe ownership also covers PyInstaller's intermediate bootloader process."""

import asyncio
import os
import sys
from collections.abc import Callable


def watch_parent_pipe(on_exit: Callable[[], None]) -> Callable[[], None]:
    if os.getenv("MLX_STUDIO_PARENT_PIPE") != "1":
        return lambda: None
    if sys.stdin is None:
        raise RuntimeError("Desktop parent pipe is unavailable")
    descriptor = sys.stdin.fileno()
    loop = asyncio.get_running_loop()

    def release() -> None:
        loop.remove_reader(descriptor)

    def readable() -> None:
        try:
            data = os.read(descriptor, 4096)
        except OSError:
            data = b""
        if not data:
            release()
            on_exit()

    loop.add_reader(descriptor, readable)
    return release
