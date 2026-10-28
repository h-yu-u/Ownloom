"""Loopback-only FastAPI Supervisor API with ephemeral bearer authentication."""

import hmac
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from mlx_studio_runtime.adapters.data_profiles import resolve_profile
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import SQLiteRepositories
from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeFault, error_payload
from mlx_studio_runtime.entrypoints.http.agent_chat_routes import register_agent_chat_routes
from mlx_studio_runtime.entrypoints.http.attachment_routes import register_attachment_routes
from mlx_studio_runtime.entrypoints.http.audio_routes import register_audio_routes
from mlx_studio_runtime.entrypoints.http.capability_routes import register_capability_routes
from mlx_studio_runtime.entrypoints.http.coding_routes import register_coding_routes
from mlx_studio_runtime.entrypoints.http.contracts import (
    ErrorEnvelope,
)
from mlx_studio_runtime.entrypoints.http.conversation_routes import register_conversation_routes
from mlx_studio_runtime.entrypoints.http.data_admission import DataAdmissionMiddleware
from mlx_studio_runtime.entrypoints.http.data_routes import register_data_routes
from mlx_studio_runtime.entrypoints.http.event_routes import register_event_routes
from mlx_studio_runtime.entrypoints.http.extension_routes import register_extension_routes
from mlx_studio_runtime.entrypoints.http.image_studio import register_image_studio_routes
from mlx_studio_runtime.entrypoints.http.inference_routes import register_inference_routes
from mlx_studio_runtime.entrypoints.http.model_routes import register_model_routes
from mlx_studio_runtime.entrypoints.http.runtime_routes import register_runtime_routes
from mlx_studio_runtime.entrypoints.http.web_search_routes import register_web_search_routes

RUNTIME_SOURCE = Path(__file__).parents[3]


def _data_path() -> Path:
    configured = os.getenv("MLX_STUDIO_DATA_DIR")
    if configured:
        return resolve_profile(Path(configured).expanduser() / "app.db")
    # Keep the pre-Ownloom location so standalone upgrades retain existing histories and media.
    return resolve_profile(
        Path.home() / "Library" / "Application Support" / "MLX Studio" / "data" / "app.db"
    )


def create_app(
    session_token: str | None = None,
    database_path: Path | None = None,
    external_api_enabled: bool | None = None,
) -> FastAPI:
    token = (
        session_token if session_token is not None else os.getenv("MLX_STUDIO_SESSION_TOKEN", "")
    )
    external_enabled = (
        external_api_enabled
        if external_api_enabled is not None
        else os.getenv("MLX_STUDIO_EXTERNAL_API_ENABLED", "false").lower() == "true"
    )
    store = SQLiteRepositories(database_path or _data_path())
    service = RuntimeApplication(store, RUNTIME_SOURCE)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await service.close()

    app = FastAPI(
        title="Ownloom Runtime",
        version="0.1.0",
        openapi_url="/internal/v1/openapi.json",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
        responses={
            code: {"model": ErrorEnvelope} for code in [400, 401, 404, 409, 413, 415, 422, 503]
        },
    )
    app.state.service = service
    app.state.started_at = time.monotonic()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "tauri://localhost",
            "http://tauri.localhost",
            "http://127.0.0.1:1420",
            "http://localhost:1420",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    app.add_middleware(DataAdmissionMiddleware, admission=service.data.admission)

    @app.middleware("http")
    async def add_request_id(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    async def authenticate(authorization: str | None = Header(default=None)) -> None:
        if not token:
            raise HTTPException(status_code=503, detail="RUNTIME_SESSION_TOKEN_MISSING")
        expected = f"Bearer {token}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="UNAUTHORIZED")

    @app.exception_handler(RuntimeFault)
    async def runtime_fault_handler(request: Request, error: RuntimeFault):
        return JSONResponse(
            status_code=_status_for_code(error.info.code),
            content=error_payload(error, request.state.request_id),
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, error: HTTPException):
        code = error.detail if isinstance(error.detail, str) else "REQUEST_REJECTED"
        return JSONResponse(
            status_code=error.status_code,
            content={
                "error": {
                    "code": code,
                    "message": "请求未通过 Runtime 校验",
                    "retryable": False,
                    "details": {},
                    "request_id": request.state.request_id,
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, _error: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "请求参数无效",
                    "retryable": False,
                    "details": {},
                    "request_id": request.state.request_id,
                }
            },
        )

    register_data_routes(app, service, authenticate)
    register_runtime_routes(app, service, authenticate)
    register_model_routes(app, service, authenticate)
    register_attachment_routes(app, service, authenticate)
    register_web_search_routes(app, service, authenticate)
    register_conversation_routes(app, service, authenticate)
    register_image_studio_routes(app, service, authenticate)
    register_audio_routes(app, service, authenticate)
    register_event_routes(app, service, authenticate)
    register_coding_routes(app, service, authenticate)
    register_extension_routes(app, service, authenticate)
    register_inference_routes(app, service, authenticate)
    register_capability_routes(app, service, authenticate)
    register_agent_chat_routes(app, service, authenticate)

    if external_enabled:
        _register_openai_api(app, service, os.getenv("MLX_STUDIO_EXTERNAL_API_TOKEN", ""))
    return app


def _register_openai_api(app: FastAPI, service: RuntimeApplication, token: str) -> None:
    if not token:
        raise RuntimeError("External API requires its own token")

    async def external_auth(authorization: str | None = Header(default=None)) -> None:
        if authorization is None or not hmac.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(status_code=401, detail="UNAUTHORIZED")

    @app.get("/v1/models", dependencies=[Depends(external_auth)])
    async def external_models() -> dict[str, object]:
        return {
            "object": "list",
            "data": [
                {"id": model["id"], "object": "model"} for model in service.catalog.list_models()
            ],
        }

    @app.post("/v1/chat/completions", dependencies=[Depends(external_auth)])
    async def external_chat(body: dict[str, Any]) -> dict[str, object]:
        raise HTTPException(status_code=501, detail="STREAMING_COMPATIBILITY_NOT_AVAILABLE")


def _status_for_code(code: str) -> int:
    if code in {"ATTACHMENT_TOO_LARGE", "ATTACHMENT_TOTAL_LIMIT", "AUDIO_TOO_LARGE"}:
        return 413
    if code in {
        "IMAGE_FORMAT_UNSUPPORTED",
        "ATTACHMENT_TYPE_UNSUPPORTED",
        "AUDIO_FORMAT_UNSUPPORTED",
    }:
        return 415
    if code in {
        "MODEL_IN_USE",
        "AUDIO_ASSET_IN_USE",
        "CONVERSATION_IN_USE",
        "IDEMPOTENCY_CONFLICT",
        "UPLOAD_IDEMPOTENCY_CONFLICT",
        "DRAFT_REVISION_CONFLICT",
        "DRAFT_CLOSED",
        "CONVERSATION_BUSY",
        "WEB_CONFIG_CONFLICT",
        "EXTENSION_REVISION_CONFLICT",
        "JOB_QUEUE_FULL",
        "CODING_BUSY",
        "SESSION_IN_USE",
        "RESTORE_CONFLICT",
        "RESTORE_BUSY",
        "FILE_VERSION_CONFLICT",
        "PROJECT_HAS_SESSIONS",
        "BACKUP_BUSY",
        "BACKUP_IN_PROGRESS",
    }:
        return 409
    if code == "MODEL_REMOVAL_FAILED":
        return 503
    return 404 if code.endswith("NOT_FOUND") else 503 if code.endswith("NOT_AVAILABLE") else 400


def _not_found(code: str, message: str):
    from mlx_studio_runtime.domain.errors import RuntimeErrorInfo

    return RuntimeErrorInfo(code, message)


def _unavailable(code: str, message: str):
    from mlx_studio_runtime.domain.errors import RuntimeErrorInfo

    return RuntimeErrorInfo(code, message, retryable=True)
