"""Packaged Chinese long-form speech samples and objective audio checks; no MOS claim."""

import argparse
import asyncio
import io
import json
import math
import struct
import tempfile
import wave
from pathlib import Path

from verify_local_image import start_runtime, stop_runtime
from verify_local_speech import generate, response, wav

REFERENCE = "欢迎收听本地语音测试。今天阳光明媚，我们一起把复杂的事情讲清楚。"
TEXT = (
    "这是一次较长中文的语音验收。我们先读一段日常说明，再检查数字、英文缩写和自然停顿。"
    "清晨，窗外的树叶被微风轻轻吹动。桌上的茶水还冒着热气，电脑已经准备好处理今天的任务。"
    "使用本地人工智能时，模型文件保存在自己的设备上；准备好资源之后，即使没有网络，也可以继续工作。"
    "请注意，生成完成、文件保存成功和声音听起来自然，是三个需要分别检查的结果。"
    "现在读一组数字：二零二六年十月十九日，上午九点三十分，温度二十三点五摄氏度。"
    "接下来是英文缩写：MLX、CPU、GPU，以及一个简单的英文句子，Have a nice day。"
    "遇到逗号时，语气稍作停顿；遇到句号时，结束当前句子。段落之间应该清楚衔接，"
    "不能突然换成另一种声音，也不应该重复上一句话。最后，请完整读出这句话："
    "所有测试样本都来自合成声音，不包含私人录音。感谢收听，本次长文本到这里结束。"
)


def audio_metrics(content: bytes) -> dict[str, object]:
    with wave.open(io.BytesIO(content)) as stream:
        rate, channels, width = (
            stream.getframerate(),
            stream.getnchannels(),
            stream.getsampwidth(),
        )
        frames = stream.getnframes()
        raw = stream.readframes(frames)
    if rate != 24000 or channels != 1 or width != 2 or len(raw) != frames * 2:
        raise RuntimeError("Unexpected acceptance WAV format")
    samples = struct.unpack("<" + "h" * frames, raw)
    rms = math.sqrt(sum(value * value for value in samples) / frames) / 32768
    block = max(1, rate // 50)
    quiet = []
    for offset in range(0, frames, block):
        window = samples[offset : offset + block]
        energy = math.sqrt(sum(value * value for value in window) / len(window)) / 32768
        quiet.append(energy < 0.005)
    longest = current = trailing = 0
    for silent in quiet:
        current = current + 1 if silent else 0
        longest = max(longest, current)
    for silent in reversed(quiet):
        if not silent:
            break
        trailing += 1
    clipped = sum(abs(value) >= 32760 for value in samples) / frames
    duration = frames / rate
    result = {
        "duration_seconds": round(duration, 3),
        "rms": round(rms, 6),
        "peak": max(abs(value) for value in samples) / 32768,
        "clipped_sample_fraction": round(clipped, 7),
        "quiet_window_fraction": round(sum(quiet) / len(quiet), 4),
        "longest_quiet_seconds": round(longest * 0.02, 3),
        "trailing_quiet_seconds": round(trailing * 0.02, 3),
        "frames": frames,
        "sample_rate": rate,
        "channels": channels,
    }
    if rms < 0.005 or clipped > 0.05 or trailing * 0.02 > 3:
        raise RuntimeError("Speech signal quality failed: " + json.dumps(result))
    return result


async def run(args: argparse.Namespace) -> None:
    args.output.mkdir(parents=True, exist_ok=False)
    report: dict[str, object] = {"status": "running", "text_characters": len(TEXT)}
    (args.output / "long-text.txt").write_text(TEXT)
    try:
        with tempfile.TemporaryDirectory(prefix="mlx-speech-quality-") as directory:
            process, client = await start_runtime(directory, args.sidecar)
            try:
                async with client:
                    preset = await response(
                        client,
                        "POST",
                        "/models/import",
                        json={"path": args.preset_model},
                    )
                    clone = await response(
                        client,
                        "POST",
                        "/models/import",
                        json={"path": args.clone_model},
                    )
                    operation = next(
                        op
                        for op in preset["speech"]["operations"]
                        if op["mode"] == "preset"
                    )
                    parameters = {
                        "modelId": preset["id"],
                        "mode": "preset",
                        "language": "zh",
                        "speaker": operation["presetSpeakers"][0],
                    }
                    reference = await generate(
                        client, {**parameters, "text": REFERENCE}
                    )
                    reference_bytes, reference_meta = await wav(
                        client, reference["artifact_id"], args.output / "reference.wav"
                    )
                    report["reference"] = {
                        **reference_meta,
                        **audio_metrics(reference_bytes),
                    }
                    asset = await response(
                        client,
                        "POST",
                        "/audio-assets?filename=generated-reference.wav",
                        content=reference_bytes,
                    )
                    voice = await response(
                        client,
                        "POST",
                        "/voices",
                        json={
                            "name": "长文本验收合成音色",
                            "reference_asset_id": asset["id"],
                            "reference_text": REFERENCE,
                            "language": "zh",
                            "source": "generated",
                            "consent": True,
                        },
                    )
                    samples = {}
                    for name, sample_parameters in [
                        ("preset-long", parameters),
                        (
                            "clone-long",
                            {
                                "modelId": clone["id"],
                                "mode": "clone",
                                "voiceId": voice["id"],
                                "language": "zh",
                            },
                        ),
                    ]:
                        print("Generating " + name, flush=True)
                        job = await generate(
                            client, {**sample_parameters, "text": TEXT}
                        )
                        content, metadata = await wav(
                            client, job["artifact_id"], args.output / (name + ".wav")
                        )
                        metrics = audio_metrics(content)
                        if float(metrics["duration_seconds"]) < len(TEXT) * 0.08:
                            raise RuntimeError("Long-form audio is suspiciously short")
                        samples[name] = {**metadata, **metrics}
                    report["samples"] = samples
                    await response(client, "POST", f"/models/{clone['id']}/unload")
                    report["worker_released"] = (
                        await response(client, "GET", "/runtime/metrics")
                    )["worker_memory_bytes"] == 0
                    report["subjective_review"] = {
                        "status": "requires_human_listening",
                        "items": [
                            "intelligibility/text completeness",
                            "punctuation prosody",
                            "voice consistency",
                            "reference speaker similarity",
                        ],
                        "reason": "WAV and energy checks do not establish pronunciation, naturalness or identity similarity.",
                    }
                    report["status"] = (
                        "objective_checks_passed_subjective_review_pending"
                    )
            finally:
                await client.aclose()
                await stop_runtime(process)
    except BaseException as error:
        report.update(status="failed", error=str(error))
        raise
    finally:
        (args.output / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar", required=True)
    parser.add_argument("--preset-model", required=True)
    parser.add_argument("--clone-model", required=True)
    parser.add_argument("--output", type=Path, required=True)
    asyncio.run(run(parser.parse_args()))
