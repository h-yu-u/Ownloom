"""Request identity is frozen before consulting mutable settings or performing preparation."""

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from mlx_studio_runtime.application.chat_preparation import ChatPreparation
from mlx_studio_runtime.application.ports import (
    ConversationRepository,
    JobAdmission,
    SubmissionJournal,
)
from mlx_studio_runtime.domain.chat_context import fingerprint
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.jobs import Job, JobState
from mlx_studio_runtime.domain.models import ModelManifest
from mlx_studio_runtime.domain.web import WebConfig


@dataclass(frozen=True)
class ChatAcceptance:
    job: Job
    request: dict[str, Any]
    is_new: bool
    config: WebConfig | None
    snapshot: dict[str, Any] | None


class ChatAdmission:
    def __init__(
        self,
        conversations: ConversationRepository,
        models: dict[str, ModelManifest],
        scheduler: JobAdmission,
        journal: SubmissionJournal,
        preparation: ChatPreparation,
    ) -> None:
        self.conversations = conversations
        self.models = models
        self.scheduler = scheduler
        self.journal = journal
        self.preparation = preparation

    async def admit(
        self, conversation_id: str, intent: dict[str, Any], request_id: str | None
    ) -> tuple[Job | None, dict[str, Any]]:
        previous = self.journal.find(conversation_id, request_id) if request_id else None
        digest = request_digest(intent, previous[2] if previous else 2)
        if previous:
            if previous[0] != digest:
                raise RuntimeFault(
                    RuntimeErrorInfo("IDEMPOTENCY_CONFLICT", "请求编号已用于不同输入")
                )
            return None, self.response(previous[1])
        conversation = self._require_conversation(conversation_id)
        model = self._require_model(intent["model_id"])
        target, replace_id = self._target(conversation, intent)
        turn_id = str(target.get("turnId") or target["id"]) if target else str(uuid.uuid4())
        content = target["content"] if target else intent["content"]
        ids = (
            [item["id"] for item in target.get("attachments", [])]
            if target
            else intent["attachment_ids"]
        )
        await self._prepare_legacy(target, ids, conversation_id)
        if not content.strip() and not ids:
            raise RuntimeFault(RuntimeErrorInfo("MESSAGE_EMPTY", "请输入问题或添加可用附件"))
        options = intent["web_search"]
        if options["enabled"] and not content.strip():
            raise RuntimeFault(RuntimeErrorInfo("WEB_QUERY_REQUIRED", "联网搜索需要明确问题"))
        config = (
            self.preparation.configs.get(options["config_id"], options["config_revision"])
            if options["enabled"]
            else None
        )
        target_parameters = target.get("parameters", {}) if target else {}
        accepted = target_parameters.get("acceptedSnapshot")
        if target_parameters.get("acceptedContextJobId"):
            accepted = self.preparation.contexts.job(target_parameters["acceptedContextJobId"])[
                "request"
            ]["acceptedSnapshot"]
        accepted = accepted or self.preparation.accept(
            conversation, ids, intent["visual_selection"], model, target["id"] if target else None
        )
        if self.preparation.extensions and "skillContext" not in accepted:
            skill_context = await self.preparation.extensions.text_skills(
                {"workspace": "chat", "kind": "workspace", "scopeId": "default"},
                intent.get("extension_selection") or {"skillIds": [], "toolIds": []},
            )
            accepted = {**accepted, "skillContext": skill_context}
        accepted = bind_turn_references(accepted, turn_id)
        self.preparation.validate_visuals(accepted["visuals"], model)
        job = Job(str(uuid.uuid4()), "chat", JobState.QUEUED, model.id)
        request = {
            "conversationId": conversation_id,
            "turnId": turn_id,
            "content": content,
            "attachmentIds": ids,
            "maxTokens": intent["max_tokens"],
            "temperature": intent["temperature"],
            "operation": intent["operation"],
            "webSearch": options,
            "acceptedSnapshot": accepted,
            "acceptedSnapshotHash": fingerprint({"intent": intent, "accepted": accepted}),
            "replaceAssistantMessageId": replace_id,
            "userMessageId": target["id"] if target else turn_id,
            "sourceContextJobId": intent["source_context_job_id"],
        }
        snapshot = self._load_reuse_snapshot(intent, request, model)
        if self.preparation.extensions and accepted.get("skillContext"):
            await self.preparation.extensions.validate_text(accepted["skillContext"]["snapshot"])
            self.preparation.extensions.bind_text(job.id, accepted["skillContext"]["snapshot"])
        plan = ChatAcceptance(job, request, target is None, config, snapshot)
        await self.scheduler.lifecycle.register(
            job, request, persist=lambda: self._persist(plan, request_id, digest)
        )
        return job, request

    async def _prepare_legacy(
        self, target: dict[str, Any] | None, ids: list[str], conversation_id: str
    ) -> None:
        if target and not target.get("parameters", {}).get("acceptedSnapshot"):
            for identifier in ids:
                await self.preparation.attachments.require_ready(identifier)
            if self.preparation.contexts.busy(conversation_id):
                raise RuntimeFault(RuntimeErrorInfo("CONVERSATION_BUSY", "此会话已有任务", True))

    def _load_reuse_snapshot(
        self, intent: dict[str, Any], request: dict[str, Any], model: ModelManifest
    ) -> dict[str, Any] | None:
        snapshot = None
        if intent["operation"] == "reuse_context":
            snapshot = self.preparation.contexts.load(
                intent["source_context_job_id"], request["conversationId"], request["turnId"]
            )
            snapshot = self.preparation.replay_snapshot(snapshot, model, intent["max_tokens"])

        return snapshot

    def _require_conversation(self, conversation_id: str) -> dict[str, Any]:
        conversation = self.conversations.get(conversation_id)
        if conversation is None:
            raise RuntimeFault(RuntimeErrorInfo("CONVERSATION_NOT_FOUND", "找不到此会话"))
        active = self.preparation.contexts.busy(conversation_id)
        if active:
            raise RuntimeFault(
                RuntimeErrorInfo(
                    "CONVERSATION_BUSY",
                    "此会话已有任务，请等待或停止",
                    True,
                    {"active_job_id": active},
                )
            )
        return conversation

    def _require_model(self, model_id: str) -> ModelManifest:
        model = self.models.get(model_id)
        if model is None:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_FOUND", "找不到此模型"))
        if "text" not in model.output_modalities:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_CAPABILITY_INVALID", "请选择对话模型"))
        self.scheduler.check_admission(model.id)
        return model

    def _persist(self, plan: ChatAcceptance, request_id: str | None, digest: str) -> None:
        job, request, config, snapshot = plan.job, plan.request, plan.config, plan.snapshot
        conversation_id, turn_id = request["conversationId"], request["turnId"]
        options, accepted = request["webSearch"], request["acceptedSnapshot"]
        content, ids = request["content"], request["attachmentIds"]
        if plan.is_new:
            self.conversations.update_metadata(
                conversation_id, None, None, bool(options["enabled"])
            )
            self.conversations.save_message(
                {
                    "id": turn_id,
                    "turnId": turn_id,
                    "conversationId": conversation_id,
                    "role": "user",
                    "content": content,
                    "attachmentIds": ids,
                    "parameters": {
                        "maxTokens": request["maxTokens"],
                        "temperature": request["temperature"],
                        "webSearch": options,
                        "acceptedContextJobId": job.id,
                        "attachmentPreparations": {
                            item["id"]: item["preparationId"] for item in accepted["submitted"]
                        },
                    },
                }
            )
        self.preparation.contexts.reference(job.id, "submitted", accepted["submitted"])
        if config:
            self.preparation.configs.bind_job(job.id, config)
        if snapshot:
            self.preparation.contexts.save(job.id, conversation_id, turn_id, snapshot)
        if request_id:
            self.journal.save(conversation_id, request_id, digest, job.id)

    def _target(
        self, conversation: dict[str, Any], intent: dict[str, Any]
    ) -> tuple[dict[str, Any] | None, str | None]:
        if intent["operation"] == "send":
            return None, None
        user = next(
            (
                item
                for item in conversation["messages"]
                if item["id"] == intent["target_user"] and item["role"] == "user"
            ),
            None,
        )
        if not user:
            raise RuntimeFault(RuntimeErrorInfo("MESSAGE_NOT_FOUND", "找不到原用户消息"))
        turn_id = user.get("turnId") or user["id"]
        assistant = next(
            (
                item
                for item in conversation["messages"]
                if item["role"] == "assistant" and item.get("turnId") == turn_id
            ),
            None,
        )
        return user, assistant["id"] if assistant else None

    def response(self, job_id: str) -> dict[str, Any]:
        item = self.preparation.contexts.job(job_id)
        request = item["request"]
        return {
            "jobId": job_id,
            "attemptId": job_id,
            "state": item["state"],
            "userMessageId": request.get("userMessageId", request.get("turnId", "")),
            "turnId": request.get("turnId", ""),
            "acceptedSnapshotHash": request.get("acceptedSnapshotHash", ""),
        }


def request_digest(intent: dict[str, Any], version: int) -> str:
    if version == 1:
        if (
            intent["web_search"]["enabled"]
            or intent["visual_selection"] is not None
            or intent["operation"] != "send"
        ):
            raise RuntimeFault(
                RuntimeErrorInfo("IDEMPOTENCY_CONFLICT", "旧请求编号不支持新的请求选项")
            )
        legacy = {
            "content": intent["content"],
            "model": intent["model_id"],
            "maxTokens": intent["max_tokens"],
            "temperature": intent["temperature"],
            "attachments": intent["attachment_ids"],
        }
        return hashlib.sha256(json.dumps(legacy, sort_keys=True).encode()).hexdigest()
    return fingerprint({"digestVersion": 2, **intent})


def bind_turn_references(accepted: dict[str, Any], turn_id: str) -> dict[str, Any]:
    return {
        **accepted,
        **{
            usage: [{"originTurnId": turn_id, **item} for item in accepted[usage]]
            for usage in ("submitted", "documents", "visuals")
        },
    }
