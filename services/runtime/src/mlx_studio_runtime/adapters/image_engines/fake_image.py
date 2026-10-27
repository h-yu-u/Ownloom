"""Deterministic development image output; this adapter does not run an AI model."""

import math
import struct
import zlib
from pathlib import Path


def write_fake_png(path: Path, width: int, height: int, seed: int) -> None:
    pixels = bytearray()
    phase = (seed % 1000) / 1000
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            nx, ny = x / width, y / height
            light = max(0.0, 1 - math.hypot(nx - 0.65, ny - 0.28) * 2.2)
            ridge = 0.62 + 0.09 * math.sin(nx * 18 + phase * 3)
            if ny > ridge:
                pixels.extend((int(30 + 25 * nx), int(46 + 30 * nx), int(82 + 42 * nx)))
            else:
                pixels.extend((int(55 + light * 142), int(55 + light * 75), int(105 + light * 113)))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(pixels))
        + _chunk(b"IEND", b"")
    )


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
