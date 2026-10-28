"""Opt-in local image API verification with cancellation, persistence and restart."""

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import signal
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

from scripts.verify.verify_local_chat import turn


async def start_runtime(
    directory: str,
    sidecar: str | None = None,
) -> tuple[asyncio.subprocess.Process, httpx.AsyncClient]:
    source = Path(__file__).resolve().parents[2] / "services/runtime/src"
    token = secrets.token_urlsafe(32)
    process = await asyncio.create_subprocess_exec(
        *(
            [sidecar]
            if sidecar
            else [sys.executable, "-m", "mlx_studio_runtime.entrypoints.http.main"]
        ),
        env={
            **os.environ,
            "PYTHONPATH": "" if sidecar else str(source),
            "MLX_STUDIO_DATA_DIR": directory,
            "MLX_STUDIO_SESSION_TOKEN": token,
            "HF_HUB_OFFLINE": "1",
        },
        stdout=asyncio.subprocess.PIPE,
    )
    try:
        if process.stdout is None:
            raise RuntimeError("Runtime handshake unavailable")
        ready = json.loads(await asyncio.wait_for(process.stdout.readline(), 30))
        client = httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{ready['port']}",
            trust_env=False,
            timeout=120,
            headers={"Authorization": f"Bearer {token}"},
        )
        return process, client
    except BaseException:
        await stop_runtime(process)
        raise


async def stop_runtime(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        process.send_signal(signal.SIGINT)
        try:
            await asyncio.wait_for(process.wait(), 20)
        except TimeoutError:
            process.kill()
            await process.wait()
    if process.returncode != 0:
        raise RuntimeError(f"Runtime exit was not clean: {process.returncode}")


async def image_job(
    client: httpx.AsyncClient, parameters: dict[str, Any], cancel: bool = False
) -> dict[str, Any]:
    submitted = await client.post("/internal/v1/image-jobs", json=parameters)
    submitted.raise_for_status()
    job_id = submitted.json()["id"]
    requested_cancel, saw_progress = False, False
    async with asyncio.timeout(600):
        while True:
            response = await client.get(f"/internal/v1/image-jobs/{job_id}")
            response.raise_for_status()
            job = response.json()
            if job["progress"] > 0 and job["state"] == "running":
                saw_progress = True
                if cancel and not requested_cancel:
                    response = await client.post(
                        f"/internal/v1/image-jobs/{job_id}/cancel"
                    )
                    response.raise_for_status()
                    requested_cancel = True
            if job["state"] in {"succeeded", "failed", "cancelled"}:
                expected = "cancelled" if cancel else "succeeded"
                if job["state"] != expected or job["simulated"] or not saw_progress:
                    raise RuntimeError(f"Unexpected image job result: {job}")
                return job
            await asyncio.sleep(0.25)


async def generate_and_check(
    client: httpx.AsyncClient, path: str, output: Path
) -> dict[str, Any]:
    response = await client.post("/internal/v1/models/import", json={"path": path})
    response.raise_for_status()
    model = response.json()
    if model["engine"] != "mflux" or model["task"] != "image-generation":
        raise RuntimeError("Local image model was not recognized")
    parameters = {
        "model_id": model["id"],
        "prompt": "A small red ceramic teapot on a wooden table, soft natural window light, clean composition, realistic photography.",
        "width": 512,
        "height": 512,
        "steps": 12,
        "seed": 42,
    }
    cancelled = await image_job(client, {**parameters, "steps": 80}, cancel=True)
    if (
        cancelled["artifact_id"]
        or (await client.get("/internal/v1/image-artifacts")).json()
    ):
        raise RuntimeError("Cancelled generation left an artifact")
    started = time.perf_counter()
    job = await image_job(client, parameters)
    gallery = (await client.get("/internal/v1/image-artifacts")).json()
    if len(gallery) != 1 or gallery[0]["id"] != job["artifact_id"]:
        raise RuntimeError("Gallery did not persist the real image")
    artifact = gallery[0]
    for field in ("model_id", "prompt", "width", "height", "steps", "seed"):
        if artifact[field] != parameters[field]:
            raise RuntimeError(f"Image parameter was not persisted: {field}")
    response = await client.get(
        f"/internal/v1/image-artifacts/{artifact['id']}/content"
    )
    response.raise_for_status()
    if response.headers.get("content-type") != "image/png":
        raise RuntimeError("Artifact content is not a PNG")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(response.content)
    from PIL import Image

    with Image.open(output) as image:
        image.verify()
    with Image.open(output) as image:
        if image.size != (512, 512) or image.getextrema() == ((0, 0),) * 3:
            raise RuntimeError("Image dimensions or pixels are invalid")
    return {
        "model_id": model["id"],
        "artifact_id": artifact["id"],
        "sha256": hashlib.sha256(response.content).hexdigest(),
        "dimensions": [512, 512],
        "steps": 12,
        "seed": 42,
        "generation_seconds": round(time.perf_counter() - started, 2),
        "progress": "passed",
        "cancellation_and_recovery": "passed",
        "output": str(output),
    }


async def check_restart(client: httpx.AsyncClient, result: dict[str, Any]) -> None:
    gallery = (await client.get("/internal/v1/image-artifacts")).json()
    if len(gallery) != 1 or gallery[0]["id"] != result["artifact_id"]:
        raise RuntimeError("Gallery was lost after Runtime restart")
    response = await client.get(
        f"/internal/v1/image-artifacts/{result['artifact_id']}/content"
    )
    response.raise_for_status()
    if hashlib.sha256(response.content).hexdigest() != result["sha256"]:
        raise RuntimeError("Persisted PNG changed after restart")


async def prepare_chat(client: httpx.AsyncClient, path: str) -> tuple[str, str]:
    imported = await client.post("/internal/v1/models/import", json={"path": path})
    imported.raise_for_status()
    model_id = imported.json()["id"]
    created = await client.post(
        "/internal/v1/conversations",
        json={"title": "Image switch verification", "model_id": model_id},
    )
    created.raise_for_status()
    conversation = created.json()["id"]
    await turn(client, conversation, model_id, "记住测试暗号蓝鲸。只回复已记住。")
    return conversation, model_id


async def run(
    path: str, output: Path, chat_path: str | None, sidecar: str | None = None
) -> None:
    with tempfile.TemporaryDirectory(prefix="mlx-real-image-") as directory:
        process, client = await start_runtime(directory, sidecar)
        try:
            async with client:
                chat = await prepare_chat(client, chat_path) if chat_path else None
                result = await generate_and_check(client, path, output)
                if chat:
                    reply, _ = await turn(
                        client, *chat, "刚才的测试暗号是什么？只回答暗号。"
                    )
                    if "蓝鲸" not in reply:
                        raise RuntimeError(
                            "Chat context was lost when switching to image generation"
                        )
                    result["chat_image_chat"] = "passed"
        finally:
            await stop_runtime(process)
        process, client = await start_runtime(directory, sidecar)
        try:
            async with client:
                await check_restart(client, result)
        finally:
            await stop_runtime(process)
        print(
            json.dumps(
                {**result, "restart_persistence": "passed", "shutdown": "passed"},
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--chat-model-path")
    parser.add_argument("--sidecar")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(tempfile.gettempdir()) / "mlx-studio-qwen-image.png",
    )
    arguments = parser.parse_args()
    asyncio.run(
        run(
            arguments.model_path,
            arguments.output.resolve(),
            arguments.chat_model_path,
            arguments.sidecar,
        )
    )
