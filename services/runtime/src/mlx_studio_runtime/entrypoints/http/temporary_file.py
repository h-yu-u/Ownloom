"""Disposal runs even when a client disconnects or the response sender fails."""

from collections.abc import Callable
from pathlib import Path

from starlette.responses import FileResponse
from starlette.types import Receive, Scope, Send


class TemporaryFileResponse(FileResponse):
    def __init__(self, path: Path, release: Callable[[Path], None]) -> None:
        super().__init__(path, media_type="application/zip", filename="ownloom-backup.zip")
        self._release = lambda: release(path)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            # A path-send extension can outlive __call__; keep ownership of the streamed body.
            scope = {**scope, "extensions": {}}
            await super().__call__(scope, receive, send)
        finally:
            self._release()
