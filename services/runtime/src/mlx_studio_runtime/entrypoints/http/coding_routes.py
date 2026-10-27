"""Thin authenticated Coding gateway; business state stays in the Node Host."""

import json
from collections.abc import Awaitable, Callable
from typing import Protocol

from fastapi import Depends, FastAPI, Query, Request
from fastapi.responses import StreamingResponse

from mlx_studio_runtime.application.capability_grants import CapabilityGrants
from mlx_studio_runtime.application.coding_gateway import CodingGateway
from mlx_studio_runtime.application.coding_model_requests import CodingModelRequests
from mlx_studio_runtime.application.coding_run_submission import CodingRunSubmission
from mlx_studio_runtime.application.extension_gateway import ExtensionGateway, public_projection
from mlx_studio_runtime.entrypoints.http.coding_contracts import (
    CodingApprovalRequest,
    CodingCapability,
    CodingChanges,
    CodingChangeView,
    CodingFileList,
    CodingFileView,
    CodingPermissionsRequest,
    CodingProjectPatch,
    CodingProjectRequest,
    CodingProjectView,
    CodingRunRequest,
    CodingRunView,
    CodingSessionPatch,
    CodingSessionRequest,
    CodingSessionView,
    CodingSettings,
    CodingSnapshot,
    CodingSteerRequest,
)


class CodingRouteServices(Protocol):
    coding: CodingGateway
    coding_requests: CodingModelRequests
    extensions: ExtensionGateway
    coding_submissions: CodingRunSubmission
    capability_grants: CapabilityGrants


def register_coding_routes(
    app: FastAPI, service: CodingRouteServices, authenticate: Callable[..., Awaitable[None]]
) -> None:
    from fastapi import APIRouter

    router = APIRouter(prefix="/internal/v1/coding", dependencies=[Depends(authenticate)])

    async def call(method, params):
        return public_projection(await service.coding.call(method, params))

    @router.get("/settings", response_model=CodingSettings)
    async def settings():
        return await call("settings.get", {})

    @router.patch("/settings", response_model=CodingSettings)
    async def update_settings(body: CodingSettings):
        return await call("settings.update", body.model_dump())

    @router.get("/projects", response_model=list[CodingProjectView])
    async def projects():
        return await call("projects.list", {})

    @router.post("/projects", response_model=CodingProjectView)
    async def register(body: CodingProjectRequest):
        return await call("projects.register", body.model_dump())

    @router.get("/projects/{project_id}", response_model=CodingProjectView)
    async def project(project_id: str):
        return await call("projects.get", {"id": project_id})

    @router.patch("/projects/{project_id}", response_model=CodingProjectView)
    async def update_project(project_id: str, body: CodingProjectPatch):
        return await call("projects.update", {"id": project_id, **body.model_dump()})

    @router.delete("/projects/{project_id}")
    async def remove_project(project_id: str):
        return await call("projects.remove", {"id": project_id})

    @router.get("/projects/{project_id}/sessions", response_model=list[CodingSessionView])
    async def sessions(
        project_id: str, before: str | None = None, limit: int = Query(default=100, ge=1, le=500)
    ):
        return await call(
            "sessions.list", {"projectId": project_id, "before": before, "limit": limit}
        )

    @router.post("/projects/{project_id}/sessions", response_model=CodingSessionView)
    async def create_session(project_id: str, body: CodingSessionRequest):
        return await call("sessions.create", {"projectId": project_id, **body.model_dump()})

    @router.get("/sessions/{session_id}", response_model=CodingSessionView)
    async def session(session_id: str):
        return await call("sessions.get", {"id": session_id})

    @router.patch("/sessions/{session_id}", response_model=CodingSessionView)
    async def update_session(session_id: str, body: CodingSessionPatch):
        return await call(
            "sessions.update", {"id": session_id, **body.model_dump(exclude_none=True)}
        )

    @router.delete("/sessions/{session_id}")
    async def remove_session(session_id: str):
        return await call("sessions.remove", {"id": session_id})

    @router.get("/sessions/{session_id}/snapshot", response_model=CodingSnapshot)
    async def snapshot(session_id: str):
        return await call("sessions.snapshot", {"id": session_id})

    @router.get("/sessions/{session_id}/changes", response_model=CodingChanges)
    async def changes(session_id: str, diff: bool = False, before: str | None = None):
        return await call("sessions.changes", {"id": session_id, "diff": diff, "before": before})

    @router.get("/sessions/{session_id}/files", response_model=CodingFileList)
    async def files(session_id: str):
        return await call("sessions.files", {"id": session_id})

    @router.get("/sessions/{session_id}/file", response_model=CodingFileView)
    async def read_file(session_id: str, path: str = Query(max_length=4096)):
        return await call("sessions.read", {"id": session_id, "path": path})

    @router.get("/changes/{change_id}", response_model=CodingChangeView)
    async def get_change(change_id: str):
        return await call("changes.get", {"id": change_id})

    @router.post("/changes/{change_id}/restore")
    async def restore(change_id: str):
        return await call("changes.restore", {"id": change_id})

    @router.post("/sessions/{session_id}/runs", response_model=CodingRunView)
    async def submit(session_id: str, body: CodingRunRequest, request: Request):
        params = {
            "sessionId": session_id,
            **body.model_dump(exclude={"modelId"}, exclude_none=True),
        }
        return public_projection(
            await service.coding_submissions.submit(params, str(request.base_url), body.modelId)
        )

    @router.post("/sessions/{session_id}/verify", response_model=CodingRunView)
    async def verify_session(session_id: str, body: CodingRunRequest, request: Request):
        return await service.coding_requests.call(
            "sessions.verify",
            {"sessionId": session_id, "submissionId": body.submissionId},
            str(request.base_url),
            body.modelId,
        )

    @router.post("/runs/{run_id}/steer")
    async def steer(run_id: str, body: CodingSteerRequest):
        return await call("runs.steer", {"id": run_id, **body.model_dump()})

    @router.post("/cancel-active")
    async def cancel_active():
        return await call("runs.cancel-active", {})

    @router.patch("/runs/{run_id}/permissions", response_model=CodingRunView)
    async def permissions(run_id: str, body: CodingPermissionsRequest):
        return await call("runs.permissions", {"id": run_id, **body.model_dump()})

    @router.post("/runs/{run_id}/cancel", response_model=CodingRunView)
    async def cancel(run_id: str):
        await service.capability_grants.cancel_id(run_id)
        return await call("runs.cancel", {"id": run_id})

    @router.post("/approvals/{approval_id}/resolve")
    async def resolve(approval_id: str, body: CodingApprovalRequest):
        return await call("approvals.resolve", {"id": approval_id, **body.model_dump()})

    @router.get("/capabilities", response_model=list[CodingCapability])
    async def capabilities():
        return await call("capabilities.list", {})

    @router.post("/capabilities/{model_id}/verify", response_model=CodingCapability)
    async def verify_model(model_id: str, request: Request):
        return await service.coding_requests.call(
            "capabilities.verify", {}, str(request.base_url), model_id
        )

    @router.get("/events")
    async def events(request: Request, after_seq: int = Query(default=0, ge=0)):
        async def stream():
            sequence = after_seq
            while not await request.is_disconnected():
                batch = await call("events.wait", {"after": sequence})
                for event in batch["events"]:
                    sequence = event["seq"]
                    yield f"id: {sequence}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                yield ": heartbeat\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    app.include_router(router)
