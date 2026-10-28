"""Offline speech acceptance against source Runtime or the final packaged sidecar."""

import argparse
import asyncio
import hashlib
import io
import json
import uuid
import wave
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import httpx

from scripts.verify.verify_local_image import start_runtime, stop_runtime

TEXT = "你好，这是本地语音合成验证。"


async def response(
    client: httpx.AsyncClient, method: str, path: str, **kwargs: Any
) -> Any:
    result = await client.request(method, "/internal/v1" + path, **kwargs)
    result.raise_for_status()
    return result.json()


async def wait_job(
    client: httpx.AsyncClient, identifier: str, running: bool = False
) -> dict[str, Any]:
    async with asyncio.timeout(600):
        while True:
            job = await response(client, "GET", f"/audio-generations/{identifier}")
            if running and job["state"] == "running":
                return job
            if job["state"] in {"succeeded", "failed", "cancelled"}:
                return job
            await asyncio.sleep(0.1)


async def generate(
    client: httpx.AsyncClient, request: dict[str, object]
) -> dict[str, Any]:
    job = await response(
        client,
        "POST",
        "/audio-generations",
        json={
            **request,
            "clientRequestId": str(uuid.uuid4()),
        },
    )
    completed = await wait_job(client, job["id"])
    if completed["state"] != "succeeded" or completed["simulated"]:
        raise RuntimeError(f"Speech acceptance failed: {completed['error_code']}")
    return completed


async def wav(
    client: httpx.AsyncClient, artifact: str, output: Path
) -> tuple[bytes, dict[str, object]]:
    result = await client.get(f"/internal/v1/audio-artifacts/{artifact}/content")
    result.raise_for_status()
    with wave.open(io.BytesIO(result.content)) as audio:
        if (
            audio.getnframes() <= 0
            or audio.getnchannels() != 1
            or audio.getframerate() <= 0
        ):
            raise RuntimeError("Invalid generated WAV")
        metadata = {"frames": audio.getnframes(), "sample_rate": audio.getframerate()}
    output.write_bytes(result.content)
    return result.content, {
        **metadata,
        "sha256": hashlib.sha256(result.content).hexdigest(),
    }


async def verify(
    preset_model: str, clone_model: str, output: Path, sidecar: str | None
):
    output.mkdir(parents=True, exist_ok=True)
    evidence = {}
    with TemporaryDirectory(prefix="mlx-speech-acceptance-") as directory:
        process, client = await start_runtime(directory, sidecar)
        try:
            async with client:
                preset = await response(
                    client, "POST", "/models/import", json={"path": preset_model}
                )
                base = await response(
                    client, "POST", "/models/import", json={"path": clone_model}
                )
                if preset["engine"] != "mlx-audio" or base["engine"] != "mlx-audio":
                    raise RuntimeError("Real speech models are required")
                operation = next(
                    op
                    for op in preset["speech"]["operations"]
                    if op["mode"] == "preset"
                )
                parameters = {
                    "modelId": preset["id"],
                    "mode": "preset",
                    "text": TEXT,
                    "language": "zh",
                    "speaker": operation["presetSpeakers"][0],
                }
                first = await generate(client, parameters)
                content, evidence["preset"] = await wav(
                    client, first["artifact_id"], output / "preset.wav"
                )
                asset = await response(
                    client,
                    "POST",
                    "/audio-assets?filename=generated-reference.wav",
                    content=content,
                )
                voice = await response(
                    client,
                    "POST",
                    "/voices",
                    json={
                        "name": "生成样本验收音色",
                        "reference_asset_id": asset["id"],
                        "reference_text": TEXT,
                        "language": "zh",
                        "source": "generated",
                        "consent": True,
                    },
                )
                parameters = {
                    "modelId": base["id"],
                    "mode": "clone",
                    "voiceId": voice["id"],
                    "text": "语音工作室可以在本地复用参考声音。",
                    "language": "zh",
                }
                second = await generate(client, parameters)
                _, evidence["clone"] = await wav(
                    client, second["artifact_id"], output / "clone.wav"
                )
                job = await response(
                    client,
                    "POST",
                    "/audio-generations",
                    json={
                        **parameters,
                        "text": "取消生成测试。" * 100,
                        "clientRequestId": str(uuid.uuid4()),
                    },
                )
                if (await wait_job(client, job["id"], running=True))[
                    "state"
                ] != "running":
                    raise RuntimeError(
                        "Speech job finished before cancellation could be exercised"
                    )
                await response(client, "POST", f"/audio-generations/{job['id']}/cancel")
                if (await wait_job(client, job["id"]))["state"] != "cancelled":
                    raise RuntimeError("Speech cancellation did not converge")
                await generate(client, parameters)
                await response(client, "POST", f"/models/{base['id']}/unload")
                if (await response(client, "GET", "/runtime/metrics"))[
                    "worker_memory_bytes"
                ] != 0:
                    raise RuntimeError("Speech Worker was not released")
                evidence.update(
                    {
                        "cancel_and_recovery": "passed",
                        "worker_release": "passed",
                        "models": [
                            {
                                "id": model["id"],
                                "revision": model["revision"],
                                "adapter": model["speech"]["adapterVersion"],
                            }
                            for model in [preset, base]
                        ],
                    }
                )
        finally:
            await client.aclose()
            await stop_runtime(process)
        process, client = await start_runtime(directory, sidecar)
        try:
            async with client:
                artifacts = await response(client, "GET", "/audio-artifacts")
                if len(artifacts) != 3:
                    raise RuntimeError("Speech history was not preserved on restart")
                evidence["restart_history"] = "passed"
        finally:
            await client.aclose()
            await stop_runtime(process)
    (output / "report.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2)
    )
    print(
        json.dumps(
            {"speech": "passed", "report": str(output / "report.json")},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preset-model", required=True)
    parser.add_argument("--clone-model", required=True)
    parser.add_argument("--sidecar")
    parser.add_argument("--output", type=Path, default=Path(".build/speech-acceptance"))
    args = parser.parse_args()
    asyncio.run(verify(args.preset_model, args.clone_model, args.output, args.sidecar))
