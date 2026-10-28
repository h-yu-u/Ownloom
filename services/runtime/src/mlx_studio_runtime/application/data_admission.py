"""Close mutation admission before draining work accepted by this process."""

import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class DataAdmission:
    def __init__(self, drain_timeout: float = 30) -> None:
        self.closed = False
        self._active = 0
        self._idle = asyncio.Event()
        self._idle.set()
        self._drain_timeout = drain_timeout

    def enter(self) -> Callable[[], None]:
        if self.closed:
            raise RuntimeFault(
                RuntimeErrorInfo("BACKUP_IN_PROGRESS", "正在导出或恢复资料库", retryable=True)
            )
        self._active += 1
        self._idle.clear()
        released = False

        def release() -> None:
            nonlocal released
            if released:
                return
            released = True
            self._active -= 1
            if not self._active:
                self._idle.set()

        return release

    @asynccontextmanager
    async def exclusive(self) -> AsyncIterator[None]:
        if self.closed:
            raise RuntimeFault(
                RuntimeErrorInfo("BACKUP_IN_PROGRESS", "正在导出或恢复资料库", retryable=True)
            )
        self.closed = True
        try:
            try:
                await asyncio.wait_for(self._idle.wait(), self._drain_timeout)
            except TimeoutError as error:
                raise RuntimeFault(
                    RuntimeErrorInfo(
                        "BACKUP_BUSY", "已接纳的变更尚未结束，请稍后重试", retryable=True
                    )
                ) from error
            yield
        finally:
            self.closed = False
