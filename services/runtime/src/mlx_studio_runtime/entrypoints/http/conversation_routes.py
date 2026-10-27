"""HTTP protocol adaptation; business behavior lives in application use cases."""

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Depends, FastAPI, Query

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.entrypoints.http.chat_contracts import ChatAttemptRequest
from mlx_studio_runtime.entrypoints.http.contracts import (
    ChatMessageRequest,
    ChatSubmission,
    ConversationCreate,
    ConversationPatch,
    ConversationView,
    JobSnapshot,
    JobView,
)


def _not_found(code: str, message: str) -> RuntimeErrorInfo:
    return RuntimeErrorInfo(code, message)


def register_conversation_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    @app.get(
        "/internal/v1/conversations",
        dependencies=[Depends(authenticate)],
        response_model=list[ConversationView],
    )
    async def list_conversations() -> list[dict[str, Any]]:
        return service.queries.list_conversations()

    @app.post(
        "/internal/v1/conversations",
        dependencies=[Depends(authenticate)],
        response_model=ConversationView,
    )
    async def create_conversation(body: ConversationCreate) -> dict[str, Any]:
        return await service.chat.create_conversation(body.title, body.model_id)

    @app.get(
        "/internal/v1/conversations/{conversation_id}",
        dependencies=[Depends(authenticate)],
        response_model=ConversationView,
    )
    async def get_conversation(
        conversation_id: str,
        before: str | None = None,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> dict[str, Any]:
        return service.queries.conversation(conversation_id, before, limit)

    @app.patch(
        "/internal/v1/conversations/{conversation_id}",
        dependencies=[Depends(authenticate)],
        response_model=ConversationView,
    )
    async def patch_conversation(conversation_id: str, body: ConversationPatch) -> dict[str, Any]:
        return service.queries.update_conversation(
            conversation_id, body.title, body.pinned, body.web_search_enabled
        )

    @app.delete(
        "/internal/v1/conversations/{conversation_id}", dependencies=[Depends(authenticate)]
    )
    async def delete_conversation(conversation_id: str) -> dict[str, bool]:
        return service.queries.delete(conversation_id)

    @app.post(
        "/internal/v1/conversations/{conversation_id}/messages",
        dependencies=[Depends(authenticate)],
        response_model=ChatSubmission,
    )
    async def send_message(conversation_id: str, body: ChatMessageRequest) -> dict[str, Any]:
        return await service.chat.send_message(
            conversation_id,
            body.content,
            body.model_id,
            body.max_tokens,
            body.temperature,
            body.attachment_ids,
            client_request_id=body.client_request_id,
            selection=body.selection.model_dump(exclude_none=True) if body.selection else None,
            web_search=body.web_search.model_dump(),
            visual_selection=body.visual_selection.model_dump() if body.visual_selection else None,
        )

    @app.post(
        "/internal/v1/conversations/{conversation_id}/messages/{user_message_id}/attempts",
        dependencies=[Depends(authenticate)],
        response_model=ChatSubmission,
    )
    async def attempt(
        conversation_id: str, user_message_id: str, body: ChatAttemptRequest
    ) -> dict[str, Any]:
        return await service.chat.send_message(
            conversation_id,
            "",
            body.model_id,
            body.max_tokens,
            body.temperature,
            client_request_id=body.client_request_id,
            web_search=body.web_search.model_dump(),
            operation=body.mode,
            target_user=user_message_id,
            source_context_job_id=body.source_context_job_id,
        )

    @app.post(
        "/internal/v1/conversations/{conversation_id}/regenerate",
        dependencies=[Depends(authenticate)],
    )
    async def regenerate(
        conversation_id: str, model_id: str, max_tokens: int | None = None
    ) -> dict[str, Any]:
        return await service.chat.regenerate(conversation_id, model_id, max_tokens)

    @app.post(
        "/internal/v1/conversations/{conversation_id}/cancel", dependencies=[Depends(authenticate)]
    )
    async def cancel_conversation(conversation_id: str, job_id: str) -> dict[str, str]:
        job = service.queries.job(job_id)
        if job["kind"] != "chat" or job["request"].get("conversationId") != conversation_id:
            raise RuntimeFault(_not_found("JOB_NOT_FOUND", "任务不属于此会话"))
        return await service.scheduler.cancel(job_id)

    @app.get(
        "/internal/v1/jobs", dependencies=[Depends(authenticate)], response_model=list[JobView]
    )
    async def list_jobs() -> list[dict[str, Any]]:
        return service.queries.list_jobs()

    @app.get(
        "/internal/v1/jobs/{job_id}",
        dependencies=[Depends(authenticate)],
        response_model=JobSnapshot,
    )
    async def get_job(job_id: str) -> dict[str, Any]:
        return dict(
            service.queries.job(job_id),
            event_sequence=service.events.sequence,
            instance_id=service.events.instance_id,
        )
