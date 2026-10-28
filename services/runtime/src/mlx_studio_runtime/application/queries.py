"""Read use cases keep repository access and missing-resource rules out of routes."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.chat_context_ports import ChatContexts
from mlx_studio_runtime.application.job_lifecycle import JobLifecycle
from mlx_studio_runtime.application.ports import (
    ConversationRepository,
    ImageRepository,
    JobRepository,
)
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.generation_stats import read_generation_stats


class Queries:
    def __init__(
        self,
        conversations: ConversationRepository,
        jobs: JobRepository,
        images: ImageRepository,
        lifecycle: JobLifecycle,
        image_path: Callable[[str], Path],
        contexts: ChatContexts | None = None,
        thumbnail_path: Callable[[str], Path] | None = None,
    ) -> None:
        self.conversations = conversations
        self.jobs = jobs
        self.images = images
        self.lifecycle = lifecycle
        self.image_path = image_path
        self.contexts = contexts
        self.thumbnail_path = thumbnail_path

    def conversation(
        self, conversation_id: str, before: str | None = None, limit: int = 50
    ) -> dict[str, Any]:
        item = self.conversations.page(conversation_id, before, limit)
        if item is None:
            raise RuntimeFault(RuntimeErrorInfo("CONVERSATION_NOT_FOUND", "找不到此会话"))
        item["activeJobId"] = self.contexts.busy(conversation_id) if self.contexts else None
        for message in item["messages"]:
            message["generationStats"] = (
                read_generation_stats(message.get("parameters", {}).get("generationStats"))
                if message["role"] == "assistant"
                else None
            )
        return item

    def rename(self, conversation_id: str, title: str) -> dict[str, Any]:
        if not self.conversations.rename(conversation_id, title):
            raise RuntimeFault(RuntimeErrorInfo("CONVERSATION_NOT_FOUND", "找不到此会话"))
        return self.conversation(conversation_id)

    def update_conversation(
        self,
        conversation_id: str,
        title: str | None,
        pinned: bool | None,
        web_search_enabled: bool | None = None,
    ) -> dict[str, Any]:
        if not self.conversations.update_metadata(
            conversation_id, title, pinned, web_search_enabled
        ):
            raise RuntimeFault(RuntimeErrorInfo("CONVERSATION_NOT_FOUND", "找不到此会话"))
        return self.conversation(conversation_id)

    def delete(self, conversation_id: str) -> dict[str, bool]:
        for job in self.jobs.list():
            if job["state"] not in {"succeeded", "failed", "cancelled"}:
                detail = self.jobs.get(job["id"])
                if detail and detail["request"].get("conversationId") == conversation_id:
                    raise RuntimeFault(
                        RuntimeErrorInfo("CONVERSATION_IN_USE", "会话仍有任务运行", True)
                    )
        if not self.conversations.delete(conversation_id):
            raise RuntimeFault(RuntimeErrorInfo("CONVERSATION_NOT_FOUND", "找不到此会话"))
        return {"deleted": True}

    def job(self, job_id: str) -> dict[str, Any]:
        item = self.jobs.get(job_id)
        if item is None:
            raise RuntimeFault(RuntimeErrorInfo("JOB_NOT_FOUND", "找不到此任务"))
        sources: list[dict[str, Any]] = []
        request = item["request"]
        if self.contexts and item["kind"] == "chat":
            try:
                sources = self.contexts.load(job_id, request["conversationId"], request["turnId"])[
                    "sources"
                ]
            except RuntimeFault:
                pass  # Legacy/unfinished jobs have no context yet.
        item["request"] = {
            key: value
            for key, value in request.items()
            if key not in {"acceptedSnapshot", "content"}
        }
        result_text = item.pop("resultText", "")
        result_stats = item.pop("resultGenerationStats", None)
        generation_stats = self.lifecycle.generation_stats(job_id)
        if item["state"] == "succeeded":
            generation_stats = result_stats
        elif item["state"] in {"failed", "cancelled", "cancelling"}:
            generation_stats = None
        return dict(
            item,
            text=self.lifecycle.output_text(job_id) or result_text,
            textRevision=self.lifecycle.text_revision(job_id),
            generationStats=generation_stats,
            sources=sources,
        )

    def list_conversations(self) -> list[dict[str, Any]]:
        return self.conversations.list()

    def list_jobs(self) -> list[dict[str, Any]]:
        return self.jobs.list()

    def task_summaries(self) -> list[dict[str, Any]]:
        return self.jobs.task_summaries()

    def history(self, limit: int, offset: int) -> list[dict[str, Any]]:
        return self.images.list_artifacts(limit, offset)

    def image_artifact(self, artifact_id: str) -> dict[str, Any]:
        item = self.images.get(artifact_id)
        if item is None:
            raise RuntimeFault(RuntimeErrorInfo("IMAGE_ARTIFACT_NOT_FOUND", "找不到此作品"))
        return item

    def image_content(self, artifact_id: str, thumbnail: bool = False) -> Path:
        read = self.thumbnail_path if thumbnail and self.thumbnail_path else self.image_path
        return read(str(self.image_artifact(artifact_id)["relative_path"]))
