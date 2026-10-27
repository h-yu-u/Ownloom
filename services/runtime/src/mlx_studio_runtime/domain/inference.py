"""Validate structural context without silently replacing unsupported messages."""

import json
from typing import Any


def validate_context(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> None:
    names = [tool["function"]["name"] for tool in tools]
    if len(set(names)) != len(names):
        raise ValueError("DUPLICATE_TOOL_NAME")
    seen: set[str] = set()
    pending: set[str] = set()
    for message in messages:
        role = message["role"]
        if pending and role != "tool":
            raise ValueError("TOOL_RESULTS_MISSING")
        if role == "tool":
            call_id = message.get("tool_call_id")
            if call_id not in pending:
                raise ValueError("TOOL_RESULT_ID_INVALID")
            pending.remove(call_id)
        calls = message.get("tool_calls", [])
        if calls and role != "assistant":
            raise ValueError("TOOL_CALL_ROLE_INVALID")
        for call in calls:
            if call["id"] in seen:
                raise ValueError("DUPLICATE_TOOL_ID")
            args = json.loads(call["function"]["arguments"])
            if not isinstance(args, dict):
                raise ValueError("TOOL_ARGUMENTS_INVALID")
            seen.add(call["id"])
            pending.add(call["id"])
    if pending:
        raise ValueError("TOOL_RESULTS_MISSING")


def validate_result(payload: dict[str, Any], tools: list[dict[str, Any]]) -> dict[str, Any]:
    from mlx_studio_runtime.domain.worker_protocol import MAX_RESULT_BYTES, MAX_TOOL_ARGUMENT_BYTES

    try:
        message = payload["message"]
        if message["role"] != "assistant" or payload["finish_reason"] not in {
            "stop",
            "length",
            "tool_calls",
        }:
            raise ValueError("INFERENCE_RESULT_INVALID")
        if not isinstance(message.get("content", ""), (str, type(None))):
            raise ValueError("INFERENCE_RESULT_INVALID")
        calls = message.get("tool_calls", [])
        if bool(calls) != (payload["finish_reason"] == "tool_calls"):
            raise ValueError("INFERENCE_RESULT_INVALID")
        if len(json.dumps(payload, ensure_ascii=False).encode()) > MAX_RESULT_BYTES:
            raise ValueError("INFERENCE_RESULT_TOO_LARGE")
        for call in calls:
            function = call["function"]
            if function["name"] not in {tool["function"]["name"] for tool in tools}:
                raise ValueError("UNKNOWN_TOOL")
            if len(function["arguments"].encode()) > MAX_TOOL_ARGUMENT_BYTES:
                raise ValueError("TOOL_ARGUMENTS_TOO_LARGE")
        validate_context(
            [message, *[{"role": "tool", "tool_call_id": call["id"]} for call in calls]], tools
        )
    except (ValueError, KeyError, TypeError) as error:
        from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

        raise RuntimeFault(
            RuntimeErrorInfo("INFERENCE_RESULT_INVALID", "推理结果未通过校验")
        ) from error
    return payload
