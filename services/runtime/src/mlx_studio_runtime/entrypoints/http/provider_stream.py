"""Provider compatibility frames; successful finish is emitted only after durable commit."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from mlx_studio_runtime.domain.errors import RuntimeFault


def provider_error(error: RuntimeFault) -> dict[str, object]:
    code = error.info.code
    overflow = code in {"CONTEXT_BUDGET_EXCEEDED", "EXTENSION_CONTEXT_BUDGET_EXCEEDED"}
    return {
        "error": {
            "type": "invalid_request_error" if overflow else "server_error",
            "code": "context_length_exceeded" if overflow else code,
            "param": "messages" if overflow else None,
            "message": (
                "context_length_exceeded: input plus requested output exceeds the context window."
            )
            if overflow
            else f"{error.info.message} [runtime:{code}]",
            "details": {
                **(error.info.details or {}),
                "runtimeCode": "EXTENSION_CONTEXT_BUDGET_EXCEEDED" if overflow else code,
            },
        }
    }


def usage(result: dict[str, Any]) -> dict[str, Any]:
    incoming, outgoing = int(result.get("input_tokens", 0)), int(result.get("generation_tokens", 0))
    return {
        "prompt_tokens": incoming,
        "completion_tokens": outgoing,
        "total_tokens": incoming + outgoing,
        "prompt_tokens_details": {"cached_tokens": int(result.get("cached_tokens", 0))},
    }


def frame(identity: dict[str, Any], delta: dict[str, object], reason: str | None = None) -> str:
    return (
        "data: "
        + json.dumps(
            {
                **identity,
                "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": delta, "finish_reason": reason}],
            },
            ensure_ascii=False,
        )
        + "\n\n"
    )


async def stream_result(
    task: asyncio.Task[dict[str, Any]],
    queue: asyncio.Queue[dict[str, Any]],
    identity: dict[str, Any],
) -> AsyncIterator[str]:
    emitted = ""
    try:
        yield frame(identity, {"role": "assistant"})
        while not task.done() or not queue.empty():
            try:
                event = await asyncio.wait_for(queue.get(), 0.1)
            except TimeoutError:
                continue
            if event["type"] == "text.delta":
                text = event["payload"]["text"]
                emitted += text
                yield frame(identity, {"content": text})
        result = await task
        message = result["message"]
        text = message.get("content") or ""
        if not text.startswith(emitted):
            from mlx_studio_runtime.domain.errors import RuntimeErrorInfo

            raise RuntimeFault(RuntimeErrorInfo("WORKER_PROTOCOL_INVALID", "增量与最终结果不一致"))
        if text[len(emitted) :]:
            yield frame(identity, {"content": text[len(emitted) :]})
        if message.get("tool_calls"):
            yield frame(
                identity,
                {
                    "tool_calls": [
                        {"index": index, **call} for index, call in enumerate(message["tool_calls"])
                    ]
                },
            )
        yield frame(identity, {}, result["finish_reason"])
        yield (
            "data: "
            + json.dumps(
                {
                    **identity,
                    "object": "chat.completion.chunk",
                    "choices": [],
                    "usage": usage(result),
                }
            )
            + "\n\n"
        )
        yield "data: [DONE]\n\n"
    except RuntimeFault as error:
        yield "event: error\ndata: " + json.dumps(provider_error(error)) + "\n\n"
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
