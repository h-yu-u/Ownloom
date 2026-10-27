"""Explicit versioned attachment metadata and safe preview DTOs."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CoverageView(BaseModel):
    readablePages: list[int] = Field(default_factory=list)
    unreadablePages: list[int] = Field(default_factory=list)
    complete: bool = False
    frame: int | None = None
    selectedBlocks: int | None = None
    totalBlocks: int | None = None


class ProcessingView(BaseModel):
    preparationId: str
    revision: int
    state: Literal["queued", "preparing", "ready", "partial", "needs_ocr", "failed", "cancelled"]
    pageCount: int | None = None
    coverage: CoverageView
    warnings: list[str]
    errorCode: str | None = None
    retryable: bool


class AttachmentMetadata(BaseModel):
    id: str
    kind: Literal["image", "document"]
    format: Literal["png", "jpeg", "webp", "gif", "txt", "md", "docx", "pdf"]
    mimeType: str
    originalName: str
    sizeBytes: int
    sha256: str
    processing: ProcessingView | None = None


class PreviewBlock(BaseModel):
    id: str
    text: str
    page: int | None = None
    section: str | None = None


class TextPreview(BaseModel):
    preparationId: str
    blocks: list[PreviewBlock]
    totalBlocks: int
    coverage: CoverageView
    warnings: list[str]


class DraftSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    client_upload_ids: list[str] = Field(default_factory=list, max_length=8)
