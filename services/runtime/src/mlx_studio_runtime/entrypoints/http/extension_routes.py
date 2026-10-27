"""Authenticated extension management, independent of Coding project creation."""

import json
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.responses import StreamingResponse

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.entrypoints.http.extension_contracts import (
    BindingUpdate,
    ExtensionToggle,
    McpTestRequest,
    McpWriteRequest,
    RevokeRequest,
    TextAssistantRequest,
    TextAssistantView,
)
from mlx_studio_runtime.entrypoints.http.extension_models import (
    ExtensionBinding,
    ExtensionCatalog,
    ExtensionMutation,
    ExtensionOperation,
    ExtensionResolution,
    ExtensionResolveRequest,
    ExtensionScope,
    McpInventory,
    McpServer,
    SkillImportRequest,
    SkillInspection,
)


def register_extension_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    router = APIRouter(prefix="/internal/v1/extensions", dependencies=[Depends(authenticate)])
    call = service.extensions.call

    @router.get("/catalog", response_model=ExtensionCatalog)
    async def catalog() -> Any:
        return await call("extensions.catalog.list", {})

    @router.post("/skills/preview", response_model=SkillInspection)
    async def preview_skill(body: SkillImportRequest) -> Any:
        return await call("extensions.skills.preview", body.model_dump(exclude_none=True))

    @router.post("/skills/import", response_model=ExtensionMutation)
    async def import_skill(body: SkillImportRequest) -> Any:
        return await call("extensions.skills.import", body.model_dump(exclude_none=True))

    @router.get("/skills/{identifier}", response_model=SkillInspection)
    async def skill(identifier: str, revision: int | None = Query(default=None, ge=1)) -> Any:
        return await call(
            "extensions.skills.inspect",
            {"id": identifier, **({"revision": revision} if revision is not None else {})},
        )

    @router.post("/skills/{identifier}/versions", response_model=ExtensionMutation)
    async def publish(identifier: str, body: SkillImportRequest) -> Any:
        return await call(
            "extensions.skills.publish", {**body.model_dump(exclude_none=True), "id": identifier}
        )

    @router.patch("/skills/{identifier}", response_model=ExtensionMutation)
    async def toggle(identifier: str, body: ExtensionToggle) -> Any:
        return await call("extensions.skills.update", {"id": identifier, **body.model_dump()})

    @router.post("/mcp", response_model=ExtensionMutation)
    async def save_server(body: McpWriteRequest) -> Any:
        return await service.extensions.save(body.model_dump(exclude_none=True))

    @router.patch("/mcp/{identifier}", response_model=ExtensionMutation)
    async def update_server(identifier: str, body: McpWriteRequest) -> Any:
        return await service.extensions.save(
            {**body.model_dump(exclude_none=True), "id": identifier}
        )

    @router.get("/mcp/{identifier}", response_model=McpServer)
    async def server(identifier: str, revision: int | None = Query(default=None, ge=1)) -> Any:
        return await call(
            "extensions.mcp.inspect",
            {"id": identifier, **({"revision": revision} if revision is not None else {})},
        )

    @router.post("/mcp/{identifier}/test", response_model=ExtensionOperation)
    async def test(identifier: str, body: McpTestRequest) -> Any:
        return await service.extensions.test(identifier, body.configRevision)

    @router.get("/mcp/{identifier}/tools", response_model=McpInventory)
    async def tools(identifier: str, configRevision: int = Query(ge=1)) -> Any:
        return await call(
            "extensions.mcp.tools", {"id": identifier, "configRevision": configRevision}
        )

    @router.get("/operations/{identifier}", response_model=ExtensionOperation)
    async def operation(identifier: str) -> Any:
        return await call("extensions.operations.get", {"id": identifier})

    @router.post("/operations/{identifier}/cancel", response_model=ExtensionOperation)
    async def cancel_operation(identifier: str) -> Any:
        return await call("extensions.operations.cancel", {"id": identifier})

    @router.get("/mutations/{identifier}", response_model=ExtensionMutation | None)
    async def mutation(identifier: str) -> Any:
        return await call("extensions.mutations.get", {"id": identifier})

    @router.get("/bindings", response_model=ExtensionBinding)
    async def binding(
        workspace: Literal["chat", "coding", "image", "audio"],
        kind: Literal["workspace", "project", "session"] = "workspace",
        scopeId: str = "default",
    ) -> Any:
        scope = ExtensionScope(workspace=workspace, kind=kind, scopeId=scopeId)
        return await call("extensions.bindings.get", scope.model_dump())

    @router.put("/bindings/{identifier}", response_model=ExtensionMutation)
    async def update_binding(identifier: str, body: BindingUpdate) -> Any:
        expected_id = f"{body.scope.workspace}:{body.scope.kind}:{body.scope.scopeId}"
        if identifier != expected_id:
            from fastapi import HTTPException

            raise HTTPException(422, "INVALID_EXTENSION_SCOPE")
        return await call("extensions.bindings.update", body.model_dump())

    @router.post("/resolve", response_model=ExtensionResolution)
    async def resolve(body: ExtensionResolveRequest) -> Any:
        return await call("extensions.resolve", body.model_dump(exclude_none=True))

    @router.post("/revoke", response_model=ExtensionMutation)
    async def revoke(body: RevokeRequest) -> Any:
        return await call("extensions.revoke", body.model_dump())

    @router.get("/events")
    async def events(
        request: Request, after_seq: int = Query(default=0, ge=0)
    ) -> StreamingResponse:
        async def stream():
            after = after_seq
            while not await request.is_disconnected():
                result = await call("extensions.events.wait", {"after": after})
                for event in result["events"]:
                    after = event["seq"]
                    yield f"id: {after}\ndata: {json.dumps(event)}\n\n"
                yield ": heartbeat\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    @router.post("/assist", response_model=TextAssistantView)
    async def assist(body: TextAssistantRequest) -> Any:
        return await service.text_assistant.create(body.model_dump(exclude_none=True))

    @router.get("/assist/{job_id}", response_model=TextAssistantView)
    async def assistant_job(job_id: str) -> Any:
        return service.text_assistant.get(job_id)

    @router.post("/assist/{job_id}/cancel", response_model=TextAssistantView)
    async def cancel_assistant(job_id: str) -> Any:
        return await service.text_assistant.cancel(job_id)

    app.include_router(router)
