"""Byte/structure detection. Names are hints after validating file contents."""

from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile

from mlx_studio_runtime.domain.attachments import MAX_UNPACKED_BYTES, decode_text
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


def detect_format(path: Path, name: str) -> str:
    with path.open("rb") as stream:
        header = stream.read(16)
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    if header.startswith(b"%PDF-"):
        return "application/pdf"
    if header.startswith(b"PK"):
        validate_docx(path)
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if path.stat().st_size and Path(name).suffix.lower() in {".txt", ".md"}:
        try:
            decode_text(path.read_bytes())
        except ValueError as error:
            raise RuntimeFault(RuntimeErrorInfo(str(error), "文本必须为有效 UTF-8 内容")) from error
        return "text/markdown" if Path(name).suffix.lower() == ".md" else "text/plain"
    raise RuntimeFault(
        RuntimeErrorInfo("ATTACHMENT_TYPE_UNSUPPORTED", "请选择图片、TXT、MD、DOCX 或 PDF")
    )


def validate_docx(path: Path) -> None:
    try:
        with ZipFile(path) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
            if not {"[Content_Types].xml", "word/document.xml"}.issubset(names):
                raise ValueError("DOCX_STRUCTURE_INVALID")
            if (
                len(entries) > 4096
                or sum(entry.file_size for entry in entries) > MAX_UNPACKED_BYTES
            ):
                raise ValueError("ATTACHMENT_RESOURCE_LIMIT")
            for entry in entries:
                parts = PurePosixPath(entry.filename).parts
                if entry.flag_bits & 1 or entry.filename.startswith("/") or ".." in parts:
                    raise ValueError("DOCX_STRUCTURE_INVALID")
                if "\\" in entry.filename or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("DOCX_STRUCTURE_INVALID")
    except (BadZipFile, ValueError) as error:
        raise RuntimeFault(
            RuntimeErrorInfo("ATTACHMENT_TYPE_UNSUPPORTED", "DOCX 结构无效或超过资源限制")
        ) from error
