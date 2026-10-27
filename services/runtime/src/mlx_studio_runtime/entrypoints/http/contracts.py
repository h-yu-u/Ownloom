"""Explicit query contracts; transport DTOs stay outside the domain."""

from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from mlx_studio_runtime.entrypoints.http.audio_contracts import SpeechCapabilitiesView
from mlx_studio_runtime.entrypoints.http.chat_contracts import (
    FileSource,
    VisualSelection,
    WebSearchOptions,
    WebSource,
)
from mlx_studio_runtime.entrypoints.http.extension_models import ExtensionSelection


class ReadModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class InputLimitsView(BaseModel):
    maxImages: int = Field(ge=0, le=4)


class ModelView(ReadModel):
    id: str
    displayName: str
    source: str
    engine: str
    task: str
    state: str = "available"
    localPath: str
    inputModalities: list[str]
    outputModalities: list[str]
    contextLength: int | None = None
    capabilities: dict[str, bool]
    inputLimits: InputLimitsView | None = None
    installationId: str | None = None
    managedInstallation: bool = False
    artifactIdentity: str | None = None
    speech: SpeechCapabilitiesView | None = None


class AttachmentView(ReadModel):
    id: str
    mimeType: str
    originalName: str
    kind: str | None = None
    format: str | None = None
    preparationId: str | None = None


class MessageView(ReadModel):
    id: str
    role: str
    content: str
    turnId: str
    parameters: dict[str, Any]
    attachments: list[AttachmentView]
    sources: list[FileSource | WebSource] = Field(default_factory=list)


class ConversationView(ReadModel):
    nextCursor: str | None = None
    activeJobId: str | None = None
    pinned: bool = False
    webSearchEnabled: bool = False
    id: str
    title: str
    modelId: str | None = None
    messages: list[MessageView] = Field(default_factory=list)


class ChatSubmission(ReadModel):
    jobId: str
    state: str
    attemptId: str = ""
    userMessageId: str = ""
    turnId: str = ""
    acceptedSnapshotHash: str = ""


class RuntimeInfo(ReadModel):
    worker_epoch: int = 0
    worker_phase: str = "stopped"
    loading_model_id: str | None = None
    version: str
    protocol_version: int
    pid: int
    platform: str
    state: str
    active_model_id: str | None
    event_sequence: int
    instance_id: str


class RuntimeMetrics(ReadModel):
    uptime_seconds: float
    process_max_rss_bytes: int
    disk_free_bytes: int
    worker_restarts: int
    active_jobs: int
    system_memory_total_bytes: int | None
    system_memory_used_bytes: int | None
    system_memory_available_bytes: int | None
    system_memory_used_percent: float | None
    worker_memory_bytes: int | None


class JobView(ReadModel):
    id: str
    kind: str
    state: str
    modelId: str | None
    errorCode: str | None


class JobSnapshot(JobView):
    text: str
    event_sequence: int
    instance_id: str
    phase: str = ""
    details: dict[str, Any] = Field(default_factory=dict)
    projectionVersion: int = 0
    textRevision: int = 0
    sources: list[FileSource | WebSource] = Field(default_factory=list)


class ErrorInfo(BaseModel):
    phase: str | None = None
    recoveryActions: list[str] = Field(default_factory=list)
    code: str
    message: str
    retryable: bool
    details: dict[str, Any]
    request_id: str


class ErrorEnvelope(BaseModel):
    error: ErrorInfo


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", max_length=160)
    model_id: str | None = None


class ConversationPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=160)
    pinned: bool | None = Field(default=None, strict=True)
    web_search_enabled: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if self.title is None and self.pinned is None and self.web_search_enabled is None:
            raise ValueError("Provide a title or pinned state")
        return self


class ChatMessageRequest(BaseModel):
    selection: ExtensionSelection | None = None
    model_config = ConfigDict(extra="forbid")
    content: str = Field(default="", max_length=200_000)
    model_id: str = Field(min_length=1, max_length=200)
    max_tokens: int | None = Field(default=None, ge=1)
    temperature: float = Field(default=0.7, ge=0, le=2)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    client_request_id: str | None = Field(default=None, min_length=1, max_length=100)
    web_search: WebSearchOptions = Field(default_factory=WebSearchOptions)
    visual_selection: VisualSelection | None = None

    @model_validator(mode="after")
    def require_input(self) -> Self:
        if not self.content.strip() and not self.attachment_ids:
            raise ValueError("A message requires text or attachments")
        if self.web_search.enabled and not self.content.strip():
            raise ValueError("Web search requires a question")
        return self


class ModelPathRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class ModelPullRequest(BaseModel):
    repo_id: str = Field(min_length=3, max_length=200)
    revision: str | None = Field(default=None, max_length=200)
