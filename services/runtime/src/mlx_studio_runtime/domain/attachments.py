"""Shared attachment policy and immutable extraction values; no filesystem access."""

from dataclasses import asdict, dataclass
from typing import Any

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 60 * 1024 * 1024
MAX_ATTACHMENTS = 8
MAX_PAGES = 300
MAX_TEXT_BYTES = 2 * 1024 * 1024
MAX_UNPACKED_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 40_000_000
PREPARATION_VERSION = "1"
USABLE_STATES = {"ready", "partial"}
FORMATS = {
    "image/png": ("image", "png"),
    "image/jpeg": ("image", "jpeg"),
    "image/webp": ("image", "webp"),
    "image/gif": ("image", "gif"),
    "text/plain": ("document", "txt"),
    "text/markdown": ("document", "md"),
    "application/pdf": ("document", "pdf"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("document", "docx"),
}


@dataclass(frozen=True)
class TextBlock:
    id: str
    text: str
    page: int | None = None
    section: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def attachment_type(mime_type: str) -> tuple[str, str]:
    result = FORMATS.get(mime_type)
    if result is None:
        raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_TYPE_UNSUPPORTED", "不支持此附件格式"))
    return result


def validate_attachment_set(items: list[dict[str, Any]]) -> None:
    if len(items) > MAX_ATTACHMENTS or len({item["id"] for item in items}) != len(items):
        raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_TOTAL_LIMIT", "每条消息最多 8 个不同附件"))
    if sum(int(item["sizeBytes"]) for item in items) > MAX_TOTAL_BYTES:
        raise RuntimeFault(RuntimeErrorInfo("ATTACHMENT_TOTAL_LIMIT", "附件总大小不能超过 60 MiB"))


def decode_text(data: bytes) -> str:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("ATTACHMENT_TEXT_ENCODING_INVALID") from error
    if "\x00" in text or any(ord(char) < 32 and char not in "\t\n\r\f" for char in text):
        raise ValueError("ATTACHMENT_TYPE_UNSUPPORTED")
    return text


def split_blocks(text: str, page: int | None = None, section: str | None = None) -> list[TextBlock]:
    return [
        TextBlock(f"p{page or 0}-b{index}", text[start : start + 1600], page, section)
        for index, start in enumerate(range(0, len(text), 1600))
        if text[start : start + 1600].strip()
    ]
