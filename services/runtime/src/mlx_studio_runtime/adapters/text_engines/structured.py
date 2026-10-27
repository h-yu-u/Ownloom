"""One tool-aware Worker request. Native formats never leak into product tools."""

import json
import re
import sys
import time
import uuid
from contextlib import redirect_stdout
from typing import Any

from mlx_studio_runtime.adapters.text_engines.structured_input import prepare_input
from mlx_studio_runtime.domain.worker_protocol import MAX_RESULT_BYTES, text_parts


def parse_completion(
    text: str, tools: list[dict[str, Any]], reason: str, parser: str = "json"
) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": text}
    if "<tool_call>" not in text:
        if "</tool_call>" in text:
            raise ValueError("TOOL_FORMAT_INVALID")
        return {"message": message, "finish_reason": reason}
    if reason == "length":
        raise ValueError("TOOL_OUTPUT_TRUNCATED")
    fragments = re.findall(r"<tool_call>(.*?)</tool_call>", text, re.DOTALL)
    if (
        not 1 <= len(fragments) <= 48
        or len(fragments) != text.count("<tool_call>")
        or len(fragments) != text.count("</tool_call>")
    ):
        raise ValueError("TOOL_FORMAT_INVALID")
    # Parse the whole batch before returning any calls. Pi executes our tools sequentially.
    message["tool_calls"] = [parse_call(fragment.strip(), tools, parser) for fragment in fragments]
    message["content"] = re.sub(r"<tool_call>.*?</tool_call>", "", text, flags=re.DOTALL)
    return {"message": message, "finish_reason": "tool_calls"}


def parse_call(text: str, tools: list[dict[str, Any]], parser: str) -> dict[str, Any]:
    try:
        value = parse_xml_call(text, tools) if parser == "qwen-xml" else json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("TOOL_JSON_INVALID") from error
    if not isinstance(value, dict) or not isinstance(value.get("arguments"), dict):
        raise ValueError("TOOL_ARGUMENTS_INVALID")
    name = value.get("name")
    if name not in {tool["function"]["name"] for tool in tools}:
        raise ValueError("UNKNOWN_TOOL")
    return {
        "id": f"call_{uuid.uuid4().hex}",
        "type": "function",
        "function": {
            "name": name,
            "arguments": json.dumps(value["arguments"], ensure_ascii=False),
        },
    }


def parse_xml_call(text: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
    match = re.fullmatch(r"<function=([A-Za-z0-9_]+)>(.*?)</function>", text, re.DOTALL)
    if match is None:
        raise ValueError("TOOL_XML_INVALID")
    name, body = match.groups()
    schema = next(
        (tool["function"]["parameters"] for tool in tools if tool["function"]["name"] == name), None
    )
    if schema is None:
        raise ValueError("UNKNOWN_TOOL")
    args: dict[str, object] = {}
    parameters = re.findall(r"<parameter=([A-Za-z0-9_]+)>(.*?)</parameter>", body, re.DOTALL)
    if re.sub(r"<parameter=[A-Za-z0-9_]+>.*?</parameter>", "", body, flags=re.DOTALL).strip():
        raise ValueError("TOOL_XML_INVALID")
    for key, value in parameters:
        if key in args or key not in schema.get("properties", {}):
            raise ValueError("TOOL_ARGUMENTS_INVALID")
        definition = schema["properties"][key]
        value = value.removeprefix("\n").removesuffix("\n")
        alternatives = definition.get("anyOf", [])
        allows_null = definition.get("type") == "null" or any(
            item.get("type") == "null" for item in alternatives
        )
        if value.strip() == "null" and allows_null:
            args[key] = None
        elif definition.get("type", "string") == "string":
            args[key] = value
        else:
            args[key] = json.loads(value)
    if any(key not in args for key in schema.get("required", [])):
        raise ValueError("TOOL_ARGUMENTS_INVALID")
    return {"name": name, "arguments": args}


def scripted_reply(payload: dict[str, Any]) -> str:
    """Deterministic failing-check/repair provider exercised through the real Pi SDK."""
    messages = payload["messages"]
    if any("Local capability probe:" in str(item.get("content")) for item in messages):
        calls = [
            call["function"]["name"] for item in messages for call in item.get("tool_calls", [])
        ]
        names = {tool["function"]["name"] for tool in payload["tools"]}
        for name, args in [
            ("image_generate", {"prompt": "a test lake", "width": 64, "height": 64, "steps": 1}),
            ("speech_generate", {"text": "测试口播", "language": "zh"}),
        ]:
            if name in names and name not in calls:
                return (
                    "<tool_call>"
                    + json.dumps({"name": name, "arguments": args}, ensure_ascii=False)
                    + "</tool_call>"
                )
        return "本地能力协议验证完成，作品已由工具返回。"
    probe = any("Coding capability probe:" in str(item.get("content")) for item in messages)
    if not probe:
        return "Fake Coding provider：仅用于开发协议验证。请验证并选择真实本地模型。"
    previous = [item for item in messages if item["role"] == "tool"]
    name, args = "read", {"path": "probe.txt"}
    if previous:
        calls = [call for item in messages for call in item.get("tool_calls", [])]
        last_name = calls[-1]["function"]["name"]
        if last_name == "read":
            result = json.loads(previous[-1]["content"])
            # First attempt deliberately fails to prove that the agent uses tool evidence.
            content = (
                "after\n"
                if any(
                    '"exitCode":1' in str(item.get("content", "")).replace(" ", "")
                    for item in previous
                )
                else "broken\n"
            )
            name, args = (
                "write",
                {"path": "probe.txt", "content": content, "expectedHash": result["sha256"]},
            )
        elif last_name == "write":
            name, args = "run_command", {"command": "/usr/bin/grep -qx 'after' probe.txt"}
        elif last_name == "run_command":
            result = json.loads(previous[-1]["content"])
            if result["exitCode"] == 0:
                return "已读取并修改 probe.txt，失败后修复，验证退出码为 0。"
    prefix = '<tool_call>{"name":"list","arguments":{}}</tool_call>\n' if not previous else ""
    return (
        prefix
        + "<tool_call>"
        + json.dumps({"name": name, "arguments": args}, ensure_ascii=False)
        + "</tool_call>"
    )


def generate_structured(session: Any, payload: dict[str, Any]) -> None:
    job_id = str(payload["job_id"])
    session.finish_reason = "stop"
    session.generation_tokens = 0
    session.emit("generation.started", {"job_id": job_id})
    try:
        rendered, parser, budget = prepare_input(session, payload)
        session.emit("generation.admitted", {"job_id": job_id, "budget": budget})
        if session.engine == "fake":
            text = scripted_reply(payload)
            session.generation_tokens = len(text)
            visible = text.split("<tool_call>", 1)[0]
            for part in text_parts(visible):
                session.emit("text.delta", {"job_id": job_id, "text": part})
                time.sleep(0.005)
        else:
            with redirect_stdout(sys.stderr):
                text = _generate_native(session, rendered, payload)
        if session.cancel.is_set() or session.shutdown.is_set():
            session.emit("generation.cancelled", {"job_id": job_id})
            return
        result = parse_completion(text, payload["tools"], session.finish_reason, parser)
        session.emit(
            "generation.result",
            {
                "job_id": job_id,
                **result,
                "generation_tokens": session.generation_tokens,
                "input_tokens": budget["inputTokens"],
                "budget": budget,
            },
        )
        session.emit(
            "generation.completed", {"job_id": job_id, "finish_reason": result["finish_reason"]}
        )
    except Exception as error:  # Worker boundary, sanitized error code only.
        session.emit(
            "generation.failed",
            {
                "job_id": job_id,
                "budget": getattr(error, "budget", {}),
                "error_code": str(error)
                if isinstance(error, ValueError)
                else "STRUCTURED_INFERENCE_FAILED",
            },
        )


def _generate_native(session: Any, rendered: str, payload: dict[str, Any]) -> str:
    if session.engine == "mlx-lm":
        from mlx_lm import stream_generate  # type: ignore[import-not-found]
        from mlx_lm.sample_utils import make_sampler  # type: ignore[import-not-found]

        responses = stream_generate(
            session.model,
            session.tokenizer,
            rendered,
            max_tokens=payload["max_tokens"],
            sampler=make_sampler(temp=payload["temperature"]),
        )
    elif session.engine == "mlx-vlm":
        from mlx_vlm import stream_generate  # type: ignore[import-not-found]

        responses = stream_generate(
            model=session.model,
            processor=session.processor,
            prompt=rendered,
            max_tokens=payload["max_tokens"],
            temperature=payload["temperature"],
            verbose=False,
        )
    else:
        raise ValueError("TOOL_ENGINE_UNSUPPORTED")
    parts: list[str] = []
    size = 0
    visible = ""
    tool_started = False
    for response in responses:
        if session.cancel.is_set() or session.shutdown.is_set():
            break
        session.record_completion(response)
        chunk = str(response.text)
        size += len(chunk.encode())
        if size > MAX_RESULT_BYTES:
            raise ValueError("INFERENCE_RESULT_TOO_LARGE")
        parts.append(chunk)
        if not tool_started:
            visible += chunk
            marker = visible.find("<tool_call>")
            tool_started = marker >= 0
            # Hold a possible marker prefix across chunk boundaries.
            count = marker if tool_started else max(0, len(visible) - len("<tool_call>"))
            for part in text_parts(visible[:count]):
                session.emit("text.delta", {"job_id": payload["job_id"], "text": part})
            visible = visible[count:]
    if not tool_started:
        for part in text_parts(visible):
            session.emit("text.delta", {"job_id": payload["job_id"], "text": part})
    if session.generation_tokens >= payload["max_tokens"]:
        session.finish_reason = "length"
    return "".join(parts)
