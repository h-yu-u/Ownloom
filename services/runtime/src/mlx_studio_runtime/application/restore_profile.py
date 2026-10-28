"""Coordinate profile owners without releasing files while an importer still writes them."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from mlx_studio_runtime.application.task_completion import finish_owned_task


@dataclass(frozen=True)
class RestoreProfilePorts:
    prepare: Callable[[str], Awaitable[tuple[Path, Path]]]
    complete: Callable[[Path], bool]
    import_node: Callable[[str], Awaitable[object]]
    activate: Callable[[str], object]
    discard: Callable[[str], None]
    discard_upload: Callable[[str], None]


class RestoreProfile:
    def __init__(self, ports: RestoreProfilePorts) -> None:
        self.ports = ports

    async def execute(self, identifier: str) -> None:
        try:
            _, target = await self.ports.prepare(identifier)
            if not self.ports.complete(target):
                await self._import_node(identifier)
            self.ports.activate(identifier)
        except BaseException:
            # The profile owner preserves completed imports for a later activation retry.
            self.ports.discard(identifier)
            self.ports.discard_upload(identifier)
            raise

    async def _import_node(self, identifier: str) -> None:
        work = asyncio.ensure_future(self.ports.import_node(identifier))
        try:
            await asyncio.shield(work)
        except asyncio.CancelledError:
            try:
                await finish_owned_task(work)
            except Exception:
                pass  # Cancellation wins, but compensation must follow the import's completion.
            raise
