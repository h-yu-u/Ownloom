"""DOCX body paragraphs/tables in document order, without fabricated page numbers."""

from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from mlx_studio_runtime.adapters.attachment_formats import validate_docx
from mlx_studio_runtime.domain.attachments import MAX_TEXT_BYTES, TextBlock


def extract_docx(path: Path) -> tuple[list[TextBlock], int | None, list[int]]:
    validate_docx(path)
    document = Document(str(path))
    blocks: list[TextBlock] = []
    section = "正文"
    size = 0
    for element in document.iter_inner_content():
        text = _element_text(element)
        if (
            isinstance(element, Paragraph)
            and element.style
            and (element.style.name or "").startswith("Heading")
        ):
            section = text[:160]
        size += len(text.encode())
        if size > MAX_TEXT_BYTES:
            raise ValueError("ATTACHMENT_RESOURCE_LIMIT")
        for start in range(0, len(text), 1600):
            if text[start : start + 1600].strip():
                blocks.append(
                    TextBlock(f"b{len(blocks)}", text[start : start + 1600], section=section)
                )
    return blocks, None, []


def _element_text(element: Paragraph | Table) -> str:
    if isinstance(element, Paragraph):
        return element.text
    return "\n".join(" | ".join(cell.text for cell in row.cells) for row in element.rows)
