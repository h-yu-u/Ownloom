"""HTTP protocol adaptation; business behavior lives in application use cases."""

from collections.abc import Awaitable, Callable
from typing import Literal

from fastapi import Depends, FastAPI
from fastapi.responses import Response

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo
from mlx_studio_runtime.entrypoints.http.contracts import (
    RuntimeInfo,
    RuntimeMetrics,
)


def _not_found(code: str, message: str) -> RuntimeErrorInfo:
    return RuntimeErrorInfo(code, message)


def register_runtime_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    @app.get("/internal/v1/runtime/health", dependencies=[Depends(authenticate)])
    async def health() -> dict[str, object]:
        return service.overview.health()

    @app.get(
        "/internal/v1/runtime/info",
        dependencies=[Depends(authenticate)],
        response_model=RuntimeInfo,
    )
    async def runtime_info() -> dict[str, object]:
        return service.overview.info()

    @app.get(
        "/internal/v1/runtime/metrics",
        dependencies=[Depends(authenticate)],
        response_model=RuntimeMetrics,
    )
    async def metrics() -> dict[str, object]:
        return service.overview.metrics()

    @app.get("/internal/v1/runtime/diagnostics", dependencies=[Depends(authenticate)])
    async def diagnostics() -> dict[str, object]:
        return service.overview.diagnostics()

    @app.get("/internal/v1/runtime/diagnostics/bundle", dependencies=[Depends(authenticate)])
    async def diagnostic_bundle():
        return Response(
            service.overview.bundle(),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="ownloom-diagnostics.zip"'},
        )

    @app.post("/internal/v1/runtime/restart-worker", dependencies=[Depends(authenticate)])
    async def restart_worker(
        mode: Literal["graceful", "interrupt"] = "interrupt",
    ) -> dict[str, str]:
        return await service.controls.restart(mode)
