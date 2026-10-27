"""A ChatJob owns one answer attempt and its immutable evidence snapshot."""

import uuid
from collections.abc import AsyncIterator
from typing import Any

from mlx_studio_runtime.application.chat_admission import ChatAdmission
from mlx_studio_runtime.application.chat_preparation import ChatPreparation
from mlx_studio_runtime.application.ports import (
    ConversationRepository,
    JobAdmission,
    SubmissionJournal,
    TextInference,
)
from mlx_studio_runtime.domain.errors import ContextRebuildRequired, RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.jobs import Job, JobEvent, JobState
from mlx_studio_runtime.domain.models import ModelManifest


class ChatService:
    def __init__(
        self,
        conversations: ConversationRepository,
        preparation: ChatPreparation,
        models: dict[str, ModelManifest],
        scheduler: JobAdmission,
        runtime: TextInference,
        journal: SubmissionJournal,
    ) -> None:
        self.conversations = conversations
        self.preparation = preparation
        self.models = models
        self.scheduler = scheduler
        self.runtime = runtime
        self.job_lifecycle = scheduler.lifecycle
        self.events = runtime.events
        self.journal = journal
        self.admission = ChatAdmission(conversations, models, scheduler, journal, preparation)

    async def create_conversation(self, title: str, model_id: str | None) -> dict[str, Any]:
        item: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "title": title,
            "modelId": model_id,
            "parameters": {},
        }
        self.conversations.save(item)
        return self.conversations.get(item["id"]) or item

    async def send_message(
        self,
        conversation_id: str,
        content: str,
        model_id: str,
        max_tokens: int | None,
        temperature: float,
        attachment_ids: list[str] | None = None,
        client_request_id: str | None = None,
        web_search: dict[str, Any] | None = None,
        visual_selection: dict[str, Any] | None = None,
        operation: str = "send",
        target_user: str | None = None,
        source_context_job_id: str | None = None,
        persist_user_message: bool = True,
        turn_id: str | None = None,
        replace_assistant_message_id: str | None = None,
        selection: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not persist_user_message and target_user is None:
            conversation = self.conversations.get(conversation_id) or {"messages": []}
            user = next(
                (
                    item
                    for item in conversation["messages"]
                    if item["role"] == "user" and (item.get("turnId") or item["id"]) == turn_id
                ),
                None,
            )
            if user is None:
                raise RuntimeFault(RuntimeErrorInfo("MESSAGE_NOT_FOUND", "找不到原用户消息"))
            operation, target_user = "local_only", user["id"]
        options = web_search if web_search and web_search.get("enabled") else {"enabled": False}
        intent = {
            "content": content,
            "model_id": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "attachment_ids": attachment_ids or [],
            "web_search": options,
            "visual_selection": visual_selection,
            "operation": operation,
            "target_user": target_user,
            "source_context_job_id": source_context_job_id,
        }
        if selection is not None:
            intent["extension_selection"] = selection
        job, request = await self.admission.admit(conversation_id, intent, client_request_id)
        if job is None:
            return request
        task = self.scheduler.schedule_prepared(
            job,
            lambda: self._prepare(job, request),
            lambda snapshot: self._execute(job, request, snapshot),
            lambda result, snapshot: self._finalize(job, request, result, snapshot),
        )
        if self.preparation.extensions:
            task.add_done_callback(
                lambda _: (
                    self.preparation.extensions and self.preparation.extensions.release_text(job.id)
                )
            )
        return self.admission.response(job.id)

    async def _prepare(self, job: Job, request: dict[str, Any]) -> dict[str, Any]:
        snapshot = await self.preparation.prepare(job.id, request, self.models[job.model_id or ""])
        await self.events.publish(
            "chat.sources_ready", {"job_id": job.id, "sources": snapshot["sources"]}
        )
        return snapshot

    async def _execute(
        self, job: Job, request: dict[str, Any], snapshot: dict[str, Any]
    ) -> tuple[str, dict[str, Any]] | None:
        if snapshot.get("skillSnapshot") and self.preparation.extensions:
            await self.preparation.extensions.validate_text(snapshot["skillSnapshot"])
        try:
            return await self._collect_reply(
                job.id,
                self.runtime.generate(
                    job.id,
                    snapshot["prompt"],
                    request["maxTokens"],
                    request["temperature"],
                    self.preparation.image_paths(snapshot),
                    snapshot["messages"],
                ),
            )
        except RuntimeFault as error:
            if (
                error.info.code != "CONTEXT_BUDGET_EXCEEDED"
                or bool(self.job_lifecycle.output_text(job.id))
                or request.get("forceCompact")
                or request["operation"] == "reuse_context"
            ):
                raise
            request["forceCompact"] = True
            raise ContextRebuildRequired from error

    async def _finalize(
        self,
        job: Job,
        request: dict[str, Any],
        result: tuple[str, dict[str, Any]] | None,
        snapshot: dict[str, Any],
    ) -> None:
        if result is None:
            return
        output, completion = result

        def persist() -> None:
            self.conversations.save_message(
                {
                    "id": str(uuid.uuid4()),
                    "turnId": request["turnId"],
                    "conversationId": request["conversationId"],
                    "role": "assistant",
                    "content": output,
                    "modelSnapshot": self.models[job.model_id or ""].to_dict(),
                    "parameters": {
                        "maxTokens": request["maxTokens"],
                        "temperature": request["temperature"],
                        "finishReason": completion.get("finish_reason", "stop"),
                        "generationTokens": completion.get("generation_tokens"),
                        "jobId": job.id,
                        "contextJobId": job.id,
                        "attemptMode": request["operation"],
                        "retrieval": snapshot.get("retrieval", {}),
                        "sources": snapshot["sources"],
                    },
                },
                replace_message_id=request.get("replaceAssistantMessageId"),
            )

        await self.job_lifecycle.finish(
            job.id,
            JobEvent.COMPLETE,
            persist=persist,
            finish_reason=str(completion.get("finish_reason", "stop")),
        )

    async def _collect_reply(
        self, job_id: str, events: AsyncIterator[dict[str, Any]]
    ) -> tuple[str, dict[str, Any]] | None:
        output: list[str] = []
        completion: dict[str, Any] | None = None
        revision = 0
        async for event in events:
            kind, payload = event["type"], event["payload"]
            if kind == "generation.delta":
                if self.job_lifecycle.get(job_id).state is not JobState.RUNNING:
                    continue
                delta = str(payload.get("text", ""))
                output.append(delta)
                self.job_lifecycle.append_output(job_id, delta)
                revision += 1
                await self.events.publish(
                    kind, {"job_id": job_id, "text": delta, "textRevision": revision}
                )
            elif kind == "generation.completed":
                completion = payload
            elif kind == "generation.cancelled":
                if not self.job_lifecycle.cancellation_requested(job_id):
                    await self.job_lifecycle.transition(job_id, JobEvent.CANCEL_REQUESTED)
                await self.job_lifecycle.finish(job_id, JobEvent.CANCEL_COMPLETE)
                return None
            elif kind == "generation.failed":
                raise RuntimeFault(
                    RuntimeErrorInfo(
                        str(payload.get("error_code", "INFERENCE_FAILED")), "模型推理失败", True
                    )
                )
        if self.job_lifecycle.cancellation_requested(job_id):
            await self.job_lifecycle.finish(job_id, JobEvent.CANCEL_COMPLETE)
            return None
        if completion is None:
            raise RuntimeError("WORKER_ENDED_EARLY")
        return "".join(output), completion

    async def regenerate(
        self, conversation_id: str, model_id: str, max_tokens: int | None = None
    ) -> dict[str, Any]:
        conversation = self.conversations.get(conversation_id)
        if conversation is None:
            raise RuntimeFault(RuntimeErrorInfo("CONVERSATION_NOT_FOUND", "找不到此会话"))
        user = next(
            (item for item in reversed(conversation["messages"]) if item["role"] == "user"), None
        )
        if user is None:
            raise RuntimeFault(RuntimeErrorInfo("MESSAGE_NOT_FOUND", "没有可重新生成的用户消息"))
        params = user.get("parameters", {})
        assistant = next(
            (
                item
                for item in reversed(conversation["messages"])
                if item["role"] == "assistant" and item.get("turnId") == user.get("turnId")
            ),
            None,
        )
        source_job = assistant.get("parameters", {}).get("contextJobId") if assistant else None
        return await self.send_message(
            conversation_id,
            user["content"],
            model_id,
            max_tokens if max_tokens is not None else params.get("maxTokens"),
            float(params.get("temperature", 0.7)),
            [item["id"] for item in user.get("attachments", [])],
            client_request_id=str(uuid.uuid4()),
            operation="reuse_context" if source_job else "local_only",
            target_user=user["id"],
            source_context_job_id=source_job,
            turn_id=str(user.get("turnId") or user["id"]),
            replace_assistant_message_id=assistant["id"] if assistant else None,
        )
