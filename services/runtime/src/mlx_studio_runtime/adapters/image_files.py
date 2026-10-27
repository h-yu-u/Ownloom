"""Bounded PNG validation and managed artifact file placement."""

import struct
import zlib
from pathlib import Path

MAX_IMAGE_BYTES = 64 * 1024 * 1024


def image_output_path(media_root: Path, job_id: str) -> Path:
    root = media_root / "images" / ".pending"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{job_id}.png"


def validate_png(path: Path, width: int, height: int) -> None:
    if not path.is_file() or path.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError("IMAGE_OUTPUT_INVALID")
    content = path.read_bytes()
    if content[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("IMAGE_OUTPUT_INVALID")
    offset, compressed, ended = 8, bytearray(), False
    header: bytes | None = None
    while offset + 12 <= len(content):
        length = struct.unpack(">I", content[offset : offset + 4])[0]
        kind = content[offset + 4 : offset + 8]
        data = content[offset + 8 : offset + 8 + length]
        checksum = content[offset + 8 + length : offset + 12 + length]
        if len(checksum) != 4 or zlib.crc32(kind + data) != struct.unpack(">I", checksum)[0]:
            raise ValueError("IMAGE_OUTPUT_INVALID")
        if header is None:
            if kind != b"IHDR" or length != 13:
                raise ValueError("IMAGE_OUTPUT_INVALID")
            header = data
        elif kind == b"IDAT":
            compressed.extend(data)
        if kind == b"IEND":
            ended = length == 0 and offset + 12 == len(content)
            break
        offset += length + 12
    if not header or not ended:
        raise ValueError("IMAGE_OUTPUT_INVALID")
    actual_width, actual_height, depth, color, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB",
        header,
    )
    if (actual_width, actual_height) != (width, height) or (depth, color) not in {(8, 2), (8, 6)}:
        raise ValueError("IMAGE_OUTPUT_DIMENSIONS_INVALID")
    if (compression, filtering, interlace) != (0, 0, 0):
        raise ValueError("IMAGE_OUTPUT_INVALID")
    expected = height * (1 + width * (3 if color == 2 else 4))
    decoder = zlib.decompressobj()
    raw = decoder.decompress(bytes(compressed), expected + 1)
    if len(raw) != expected or not decoder.eof or decoder.unused_data:
        raise ValueError("IMAGE_OUTPUT_INVALID")


def commit_image(media_root: Path, source: Path, artifact_id: str) -> str:
    relative = f"images/{artifact_id}.png"
    source.replace(media_root / relative)
    return relative


def artifact_path(media_root: Path, relative_path: str) -> Path:
    root = (media_root / "images").resolve()
    path = (media_root / relative_path).resolve()
    if not path.is_relative_to(root) or path.parent != root or path.suffix != ".png":
        raise ValueError("IMAGE_PATH_INVALID")
    return path


class ImageFiles:
    def __init__(self, root: Path) -> None:
        self.root = root

    def temporary(self, job_id: str) -> Path:
        return image_output_path(self.root, job_id)

    async def validate(self, path: Path, width: int, height: int) -> None:
        import asyncio

        await asyncio.to_thread(validate_png, path, width, height)

    def commit(self, path: Path, artifact_id: str) -> str:
        return commit_image(self.root, path, artifact_id)

    def discard(self, path: Path) -> None:
        path.unlink(missing_ok=True)

    def compensate(self, relative: str) -> None:
        (self.root / relative).unlink(missing_ok=True)

    def read(self, relative: str) -> Path:
        from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

        try:
            path = artifact_path(self.root, relative)
        except ValueError as error:
            raise RuntimeFault(RuntimeErrorInfo("IMAGE_PATH_INVALID", "作品路径无效")) from error
        if not path.is_file():
            raise RuntimeFault(RuntimeErrorInfo("IMAGE_FILE_NOT_FOUND", "作品文件已不存在"))
        return path

    def thumbnail(self, relative: str) -> Path:
        import os
        import uuid

        from PIL import Image

        source = self.read(relative)
        directory = self.root / "images" / ".thumbnails"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / source.name
        if not target.is_file():
            temporary = directory / f"{uuid.uuid4()}.png"
            try:
                with Image.open(source) as image:
                    image.thumbnail((384, 384))
                    image.convert("RGB").save(temporary, "PNG")
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        return target
