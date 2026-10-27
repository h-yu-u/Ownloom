"""Strict UTF-8 text extraction."""

from pathlib import Path

from mlx_studio_runtime.domain.attachments import TextBlock, decode_text, split_blocks


def extract_text(path: Path) -> tuple[list[TextBlock], int | None, list[int]]:
    return split_blocks(decode_text(path.read_bytes())), None, []
