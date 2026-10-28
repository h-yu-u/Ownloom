"""Own the mutation lease for the entire ASGI request, including its body."""

import re

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from mlx_studio_runtime.application.data_admission import DataAdmission
from mlx_studio_runtime.domain.errors import RuntimeFault, error_payload


class DataAdmissionMiddleware:
    def __init__(self, app: ASGIApp, admission: DataAdmission) -> None:
        self.app, self.admission = app, admission

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        exclusive = scope.get("method") == "POST" and (
            path == "/internal/v1/storage/backup"
            or re.fullmatch(r"/internal/v1/storage/restore/[^/]+/activate", path) is not None
        )
        if scope["type"] != "http" or scope["method"] in {"GET", "HEAD", "OPTIONS"} or exclusive:
            await self.app(scope, receive, send)
            return
        try:
            release = self.admission.enter()
        except RuntimeFault as error:
            response = JSONResponse(
                status_code=409,
                content=error_payload(error, scope.get("state", {}).get("request_id", "")),
            )
            await response(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        finally:
            release()
