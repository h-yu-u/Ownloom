"""Opt-in real Qwen long-output, truncation, replay and cancellation verification."""

import argparse
import asyncio
import json
import statistics
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

from scripts.verify.verify_local_image import start_runtime, stop_runtime


async def chat_case(
    client: httpx.AsyncClient,
    model_id: str,
    prompt: str,
    budget: int | None = None,
    reconnect: bool = False,
    cancel: bool = False,
) -> dict[str, Any]:
    created = await client.post(
        "/internal/v1/conversations", json={"model_id": model_id}
    )
    created.raise_for_status()
    conversation = created.json()["id"]
    info = (await client.get("/internal/v1/runtime/info")).json()
    cursor = info["event_sequence"]
    body: dict[str, Any] = {"model_id": model_id, "content": prompt, "temperature": 0}
    if budget is not None:
        body["max_tokens"] = budget
    sent = await client.post(
        f"/internal/v1/conversations/{conversation}/messages", json=body
    )
    sent.raise_for_status()
    job = sent.json()["jobId"]
    chunks, arrivals = [], []
    started = time.perf_counter()
    reconnected = cancelled = False
    terminal: dict[str, Any] | None = None
    while terminal is None:
        async with client.stream(
            "GET", f"/internal/v1/events?after={cursor}"
        ) as stream:
            stream.raise_for_status()
            async for line in stream.aiter_lines():
                if not line.startswith("data:"):
                    continue
                event = json.loads(line[5:])
                if event["seq"] <= cursor:
                    continue
                cursor = event["seq"]
                payload = event["payload"]
                if payload.get("job_id") != job:
                    continue
                if event["type"] == "generation.delta":
                    chunks.append(payload["text"])
                    arrivals.append(time.perf_counter())
                    if cancel and not cancelled:
                        result = await client.post(
                            f"/internal/v1/conversations/{conversation}/cancel?job_id={job}"
                        )
                        result.raise_for_status()
                        cancelled = True
                    if reconnect and not reconnected:
                        reconnected = True
                        break
                if event["type"] in {"job.succeeded", "job.failed", "job.cancelled"}:
                    terminal = event
                    break
    expected = "job.cancelled" if cancel else "job.succeeded"
    if terminal["type"] != expected:
        raise RuntimeError(f"Unexpected terminal state: {terminal['type']}")
    result: dict[str, Any] = {"terminal": terminal["type"], "deltas": len(chunks)}
    if not cancel:
        saved = (await client.get(f"/internal/v1/conversations/{conversation}")).json()
        reply = saved["messages"][-1]
        if reply["content"] != "".join(chunks):
            raise RuntimeError("SSE output and persisted output differ")
        parameters = reply["parameters"]
        if parameters["finishReason"] != terminal["payload"]["finish_reason"]:
            raise RuntimeError("Completion reason was lost")
        result.update(parameters)
        if budget is None and (
            parameters["maxTokens"] != 4096 or parameters["generationTokens"] <= 512
        ):
            raise RuntimeError("Default long response did not exceed the old limit")
        if budget == 16 and parameters["finishReason"] != "length":
            raise RuntimeError("Truncation did not report length")
    if len(arrivals) > 1:
        gaps = [right - left for left, right in zip(arrivals, arrivals[1:])]
        result.update(
            {
                "first_delta_seconds": round(arrivals[0] - started, 3),
                "stream_seconds": round(arrivals[-1] - arrivals[0], 3),
                "median_delta_gap_ms": round(statistics.median(gaps) * 1000, 2),
                "max_delta_gap_ms": round(max(gaps) * 1000, 2),
            }
        )
    result["replay"] = "passed" if reconnected else "not_requested"
    return result


async def run(path: str, output: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="mlx-stream-check-") as directory:
        process, client = await start_runtime(directory)
        try:
            async with client, asyncio.timeout(600):
                imported = await client.post(
                    "/internal/v1/models/import", json={"path": path}
                )
                imported.raise_for_status()
                model_id = imported.json()["id"]
                prompt = "逐行输出从1到60的整数，每行写成‘数字 N：这是第 N 项测试数据。’，必须完整输出到60，不要省略，不要解释。"
                short = await chat_case(client, model_id, prompt, budget=16)
                print("Truncation reason and persistence passed", flush=True)
                long = await chat_case(client, model_id, prompt, reconnect=True)
                if long["finishReason"] != "stop":
                    raise RuntimeError("Long response did not end naturally")
                print("Long response and SSE replay passed", flush=True)
                cancelled = await chat_case(client, model_id, prompt, cancel=True)
        finally:
            await stop_runtime(process)
        result = {
            "truncation": short,
            "long_reply": long,
            "cancellation": cancelled,
            "shutdown": "passed",
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(run(args.model_path, args.output))
