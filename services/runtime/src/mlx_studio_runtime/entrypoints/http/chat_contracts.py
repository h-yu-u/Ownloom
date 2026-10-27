"""Chat input intent and public source maps; never contain credential references."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from mlx_studio_runtime.entrypoints.http.attachment_contracts import CoverageView


class WebSearchOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(default=False, strict=True)
    config_id: str | None = Field(default=None, min_length=1, max_length=100)
    config_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def require_config(self) -> Self:
        if self.enabled and (not self.config_id or self.config_revision is None):
            raise ValueError("Enabled search requires an immutable config revision")
        return self


class VisualSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["auto", "none", "explicit"]
    attachment_ids: list[str] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def require_group(self) -> Self:
        if self.mode != "explicit" and self.attachment_ids:
            raise ValueError("Only explicit selection accepts attachment IDs")
        if self.mode == "explicit" and (
            not self.attachment_ids or len(set(self.attachment_ids)) != len(self.attachment_ids)
        ):
            raise ValueError("Explicit visual group requires distinct image IDs")
        return self


class SourceLocation(BaseModel):
    blockId: str
    page: int | None = None
    section: str | None = None
    contentHash: str | None = None


class FileSource(BaseModel):
    id: str
    kind: Literal["file"]
    attachmentId: str
    preparationId: str
    originalName: str
    representation: Literal["text", "image"]
    locations: list[SourceLocation] = Field(default_factory=list)
    coverage: CoverageView = Field(default_factory=CoverageView)


class WebSource(BaseModel):
    id: str
    kind: Literal["web"]
    title: str
    url: str
    retrievedAt: str
    publishedAt: str | None = None
    representation: Literal["page_excerpt", "snippet_only"]
    contentHash: str


class ChatAttemptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_request_id: str = Field(min_length=1, max_length=100)
    mode: Literal["reuse_context", "refresh_web", "local_only"]
    source_context_job_id: str | None = None
    model_id: str = Field(min_length=1, max_length=200)
    max_tokens: int | None = Field(default=None, ge=1)
    temperature: float = Field(default=0.7, ge=0, le=2)
    web_search: WebSearchOptions = Field(default_factory=WebSearchOptions)

    @model_validator(mode="after")
    def validate_mode(self) -> Self:
        if self.mode == "reuse_context" and not self.source_context_job_id:
            raise ValueError("Context reuse requires a source context")
        if (self.mode == "refresh_web") != self.web_search.enabled:
            raise ValueError("Only refresh_web enables new network requests")
        return self
