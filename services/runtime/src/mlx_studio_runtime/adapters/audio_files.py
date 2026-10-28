"""Bounded PCM WAV inspection and managed file ownership; no optional decoder required."""

import asyncio
import hashlib
import io
import struct
import wave
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.task_completion import finish_owned_task
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

MAX_REFERENCE_BYTES = 12 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024 * 1024


def inspect_wav(content: bytes, max_seconds: int = 30) -> dict[str, Any]:
    if content[:4] != b"RIFF" or content[8:12] != b"WAVE":
        raise RuntimeFault(
            RuntimeErrorInfo("AUDIO_FORMAT_UNSUPPORTED", "请导入 16 位 PCM WAV 音频")
        )
    try:
        if struct.unpack_from("<I", content, 4)[0] + 8 != len(content):
            raise ValueError("truncated RIFF")
        with wave.open(io.BytesIO(content), "rb") as audio:
            rate, channels, frames = audio.getframerate(), audio.getnchannels(), audio.getnframes()
            if audio.getsampwidth() != 2 or channels not in {1, 2} or not 8000 <= rate <= 96000:
                raise ValueError("unsupported PCM")
            if frames < rate // 10 or frames > rate * max_seconds:
                raise ValueError("duration out of range")
            pcm = audio.readframes(frames)
            if len(pcm) != frames * channels * 2:
                raise ValueError("truncated PCM")
            peaks = []
            step = max(1, frames // 120)
            for start in range(0, frames, step):
                block = pcm[start * channels * 2 : min(frames, start + step) * channels * 2]
                peak = max((abs(s[0]) for s in struct.iter_unpack("<h", block)), default=0)
                peaks.append(round(peak / 32768, 4))
            if not any(peaks):
                raise RuntimeFault(RuntimeErrorInfo("AUDIO_SILENT", "参考音频为全静音，请更换录音"))
    except (wave.Error, EOFError, struct.error, ValueError) as error:
        raise RuntimeFault(
            RuntimeErrorInfo(
                "AUDIO_INVALID", "音频损坏或超出限制（16 位 PCM，单/双声道，0.1–30 秒）"
            )
        ) from error
    return {
        "sha256": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
        "sample_rate": rate,
        "channels": channels,
        "duration_seconds": frames / rate,
        "format": "wav",
        "peaks": peaks[:120],
    }


class AudioFiles:
    def __init__(self, root: Path) -> None:
        self.root = root
        for name in ("references", "generated", "staging"):
            (root / "audio" / name).mkdir(parents=True, exist_ok=True)

    async def upload(self, content: bytes, asset_id: str) -> dict[str, Any]:
        if len(content) > MAX_REFERENCE_BYTES:
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_TOO_LARGE", "参考音频不能超过 12 MiB"))
        metadata = await asyncio.to_thread(inspect_wav, content)
        relative = f"audio/references/{asset_id}.wav"
        pending = self.temporary(asset_id)
        try:
            write = asyncio.get_running_loop().run_in_executor(None, pending.write_bytes, content)
            try:
                await asyncio.shield(write)
            except asyncio.CancelledError:
                try:
                    await finish_owned_task(write)
                except Exception:
                    pass
                raise
            pending.replace(self.root / relative)
        finally:
            self.discard(pending)
        return dict(metadata, relative_path=relative)

    def temporary(self, job_id: str) -> Path:
        return self.root / "audio" / "staging" / f"{job_id}.wav"

    async def validate(self, path: Path) -> dict[str, Any]:
        if path.is_symlink() or path.parent.resolve() != (self.root / "audio/staging").resolve():
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_PATH_INVALID", "音频输出路径无效"))
        if not path.is_file() or path.stat().st_size > MAX_OUTPUT_BYTES:
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_OUTPUT_INVALID", "音频输出缺失或过大"))
        return await asyncio.to_thread(inspect_wav, await asyncio.to_thread(path.read_bytes), 600)

    def commit(self, path: Path, asset_id: str) -> str:
        relative = f"audio/generated/{asset_id}.wav"
        path.replace(self.root / relative)
        return relative

    def discard(self, path: Path) -> None:
        path.unlink(missing_ok=True)

    def read(self, relative: str) -> Path:
        path = self.root / relative
        directories = {
            (self.root / "audio" / name).resolve() for name in ("references", "generated")
        }
        if path.is_symlink() or path.resolve().parent not in directories or path.suffix != ".wav":
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_PATH_INVALID", "音频路径无效"))
        if not path.is_file():
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_FILE_NOT_FOUND", "音频文件已不存在"))
        return path

    def remove(self, relative: str) -> None:
        self.read(relative).unlink()
