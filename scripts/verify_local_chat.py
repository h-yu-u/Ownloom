"""Opt-in real-model HTTP/SSE verification; uses a temporary workspace by default."""

import argparse
import asyncio
import json
import os
import secrets
import signal
import sys
import tempfile
from pathlib import Path
from typing import Any

import httpx


async def turn(
    client: httpx.AsyncClient,
    conversation: str,
    model_id: str,
    prompt: str,
    cancel: bool = False,
    attachment_ids: list[str] | None = None,
) -> tuple[str, int]:
    info = (await client.get("/internal/v1/runtime/info")).json()
    async with client.stream(
        "GET", f"/internal/v1/events?after={info['event_sequence']}"
    ) as stream:
        stream.raise_for_status()
        sent = await client.post(
            f"/internal/v1/conversations/{conversation}/messages",
            json={
                "content": prompt,
                "model_id": model_id,
                "temperature": 0,
                "max_tokens": 2048 if cancel else 64,
                "attachment_ids": attachment_ids or [],
            },
        )
        sent.raise_for_status()
        job_id = sent.json()["jobId"]
        text, deltas, requested_cancel = "", 0, False
        async for line in stream.aiter_lines():
            if not line.startswith("data:"):
                continue
            event = json.loads(line[5:])
            if event["payload"].get("job_id") != job_id:
                continue
            if event["type"] == "generation.delta":
                text += event["payload"]["text"]
                deltas += 1
                if cancel and not requested_cancel:
                    response = await client.post(
                        f"/internal/v1/conversations/{conversation}/cancel?job_id={job_id}"
                    )
                    response.raise_for_status()
                    requested_cancel = True
            if event["type"] in {"job.succeeded", "job.failed", "job.cancelled"}:
                expected = "job.cancelled" if cancel else "job.succeeded"
                if event["type"] != expected or deltas == 0:
                    raise RuntimeError(
                        f"Unexpected chat terminal event: {event['type']}"
                    )
                return text, deltas
    raise RuntimeError("Event stream ended before terminal job state")


async def verify(client: httpx.AsyncClient, path: str) -> dict[str, Any]:
    response = await client.post("/internal/v1/models/import", json={"path": path})
    response.raise_for_status()
    manifest = response.json()
    if manifest["engine"] != "mlx-vlm":
        raise RuntimeError("Local Qwen must use the MLX-VLM engine")
    created = await client.post(
        "/internal/v1/conversations",
        json={
            "title": "Qwen local chat verification",
            "model_id": manifest["id"],
        },
    )
    created.raise_for_status()
    conversation = created.json()["id"]
    first = await turn(
        client, conversation, manifest["id"], "记住测试暗号是蓝鲸。只回复已记住。"
    )
    print("First real-model turn passed", flush=True)
    second = await turn(
        client, conversation, manifest["id"], "刚才的测试暗号是什么？只回答暗号。"
    )
    if "蓝鲸" not in second[0]:
        raise RuntimeError("Second turn did not retain conversation history")
    print("Multi-turn context passed", flush=True)
    restarted = await client.post("/internal/v1/runtime/restart-worker")
    restarted.raise_for_status()
    third = await turn(
        client, conversation, manifest["id"], "再重复一下刚才的暗号，只回答暗号。"
    )
    if "蓝鲸" not in third[0]:
        raise RuntimeError("Conversation context was lost after Worker restart")
    print("Worker restart and context passed", flush=True)
    saved = (await client.get(f"/internal/v1/conversations/{conversation}")).json()
    if len(saved["messages"]) != 6 or saved["messages"][-1]["content"] != third[0]:
        raise RuntimeError("Streamed output did not match persisted conversation")
    await turn(
        client,
        conversation,
        manifest["id"],
        "逐行写出从1到500的所有整数，不要省略。",
        cancel=True,
    )
    return {
        "model_id": manifest["id"],
        "model_name": manifest["displayName"],
        "first_reply": first[0],
        "follow_up": second[0],
        "after_restart": third[0],
        "stream_deltas": [first[1], second[1], third[1]],
        "persistence": "passed",
        "cancellation": "passed",
    }


async def run(path: str, sidecar: str | None = None) -> None:
    source = Path(__file__).resolve().parents[1] / "services/runtime/src"
    with tempfile.TemporaryDirectory(prefix="mlx-real-chat-") as directory:
        env = {
            **os.environ,
            "PYTHONPATH": "" if sidecar else str(source),
            "MLX_STUDIO_DATA_DIR": directory,
            "MLX_STUDIO_SESSION_TOKEN": secrets.token_urlsafe(32),
            "HF_HUB_OFFLINE": "1",
        }
        process = await asyncio.create_subprocess_exec(
            *(
                [sidecar]
                if sidecar
                else [sys.executable, "-m", "mlx_studio_runtime.entrypoints.http.main"]
            ),
            env=env,
            stdout=asyncio.subprocess.PIPE,
        )
        try:
            if process.stdout is None:
                raise RuntimeError("Runtime handshake pipe is unavailable")
            frame = await asyncio.wait_for(process.stdout.readline(), 30)
            ready = json.loads(frame)
            async with httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{ready['port']}",
                timeout=120,
                trust_env=False,
                headers={"Authorization": f"Bearer {env['MLX_STUDIO_SESSION_TOKEN']}"},
            ) as client:
                async with asyncio.timeout(600):
                    result = await verify(client, path)
        finally:
            if process.returncode is None:
                process.send_signal(signal.SIGINT)
                try:
                    await asyncio.wait_for(process.wait(), 15)
                except TimeoutError:
                    process.kill()
                    await process.wait()
        if process.returncode != 0:
            raise RuntimeError(
                f"Runtime did not shut down cleanly: {process.returncode}"
            )
        print(
            json.dumps({**result, "shutdown": "passed"}, ensure_ascii=False, indent=2)
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--sidecar")
    arguments = parser.parse_args()
    asyncio.run(run(arguments.model_path, arguments.sidecar))
