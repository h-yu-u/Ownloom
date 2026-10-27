"""Text-layer PDF extraction with explicit page coverage; never performs OCR."""

from pathlib import Path

from pypdf import PdfReader

from mlx_studio_runtime.domain.attachments import MAX_PAGES, MAX_TEXT_BYTES, TextBlock, split_blocks


def extract_pdf(path: Path) -> tuple[list[TextBlock], int | None, list[int]]:
    reader = PdfReader(path, strict=True)
    if reader.is_encrypted:
        raise ValueError("ATTACHMENT_PDF_ENCRYPTED")
    if len(reader.pages) > MAX_PAGES:
        raise ValueError("ATTACHMENT_RESOURCE_LIMIT")
    blocks: list[TextBlock] = []
    unreadable: list[int] = []
    size = 0
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        size += len(text.encode())
        if size > MAX_TEXT_BYTES:
            raise ValueError("ATTACHMENT_RESOURCE_LIMIT")
        if text.strip():
            blocks.extend(split_blocks(text, number))
        else:
            unreadable.append(number)
    return blocks, len(reader.pages), unreadable
