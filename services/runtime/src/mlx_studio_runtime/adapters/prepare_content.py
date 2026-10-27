"""Preparation process implementation. No database, network, or inference access."""

import hashlib
import json
from importlib.metadata import version
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from mlx_studio_runtime.adapters.document_extractors.docx import extract_docx
from mlx_studio_runtime.adapters.document_extractors.pdf import extract_pdf
from mlx_studio_runtime.adapters.document_extractors.text import extract_text
from mlx_studio_runtime.domain.attachments import MAX_PIXELS, MAX_TEXT_BYTES, PREPARATION_VERSION


def prepare_content(source: Path, staging: Path, format_name: str) -> dict[str, Any]:
    manifest: dict[str, Any] = {"version": PREPARATION_VERSION, "warnings": [], "coverage": {}}
    package = {"pdf": "pypdf", "docx": "python-docx"}.get(
        format_name, "pillow" if format_name in {"png", "jpeg", "gif", "webp"} else None
    )
    manifest["extractorVersion"] = version(package) if package else "utf8-strict-1"
    if format_name in {"png", "jpeg", "webp", "gif"}:
        manifest.update(_prepare_image(source, staging, format_name))
    else:
        extractor = {"pdf": extract_pdf, "docx": extract_docx}.get(format_name, extract_text)
        blocks, page_count, unreadable = extractor(source)
        raw = "".join(json.dumps(block.to_dict(), ensure_ascii=False) + "\n" for block in blocks)
        if len(raw.encode()) > MAX_TEXT_BYTES * 2:
            raise ValueError("ATTACHMENT_RESOURCE_LIMIT")
        (staging / "blocks.jsonl").write_text(raw, encoding="utf-8")
        manifest.update(
            {
                "state": "partial"
                if unreadable and blocks
                else "ready"
                if blocks
                else "needs_ocr"
                if format_name == "pdf"
                else "failed",
                "errorCode": None if blocks or format_name == "pdf" else "ATTACHMENT_TEXT_EMPTY",
                "pageCount": page_count,
                "blockCount": len(blocks),
                "blocksHash": hashlib.sha256(raw.encode()).hexdigest(),
                "coverage": {
                    "readablePages": sorted({block.page for block in blocks if block.page}),
                    "unreadablePages": unreadable,
                    "complete": not unreadable,
                },
                "warnings": ["部分页面需要 OCR，仅使用可读页面"] if unreadable else [],
            }
        )
    (staging / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def _prepare_image(source: Path, staging: Path, format_name: str) -> dict[str, Any]:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with Image.open(source) as original:
        if original.width * original.height > MAX_PIXELS:
            raise ValueError("ATTACHMENT_RESOURCE_LIMIT")
        original.seek(0)
        image = ImageOps.exif_transpose(original).convert("RGB")
        image.thumbnail((1024, 1024))
        image.save(staging / "model-input.png", "PNG")
        model_input = {
            "path": "model-input.png",
            "width": image.width,
            "height": image.height,
            "sha256": hashlib.sha256((staging / "model-input.png").read_bytes()).hexdigest(),
        }
        image.thumbnail((320, 320))
        image.save(staging / "preview.webp", "WEBP")
        thumbnail = {
            "path": "preview.webp",
            "width": image.width,
            "height": image.height,
            "sha256": hashlib.sha256((staging / "preview.webp").read_bytes()).hexdigest(),
        }
    return {
        "state": "ready",
        "modelInput": model_input,
        "thumbnail": thumbnail,
        "coverage": {"complete": True, "frame": 0},
        "warnings": ["GIF 使用首帧"] if format_name == "gif" else [],
    }
