"""Render exactly once, measure that template, then hand it to generation unchanged."""

import json
from typing import Any

from mlx_studio_runtime.domain.context_budget import ContextBudget, schema_digest


class ContextOverflow(ValueError):
    def __init__(self, budget: dict[str, object], fixed: bool = False) -> None:
        super().__init__("FIXED_CONTEXT_BUDGET_EXCEEDED" if fixed else "CONTEXT_BUDGET_EXCEEDED")
        self.budget = budget


def prepare_input(session: Any, payload: dict[str, Any]) -> tuple[str, str, dict[str, object]]:
    tokenizer: Any = None
    parser = "json"
    if session.engine == "fake":
        rendered = json.dumps(
            {"messages": payload["messages"], "tools": payload["tools"]}, ensure_ascii=False
        )
        count, revision, template_revision = len(rendered), "fake-unicode-v1", "fake-json-v1"
    else:
        tokenizer = session.tokenizer if session.engine == "mlx-lm" else session.processor.tokenizer
        template = tokenizer.chat_template
        if payload["tools"] and (not isinstance(template, str) or "<tool_call>" not in template):
            raise ValueError("TOOL_TEMPLATE_UNSUPPORTED")
        parser = "qwen-xml" if isinstance(template, str) and "<function=" in template else "json"
        messages = []
        for item in payload["messages"]:
            value = dict(item)
            if "tool_calls" in value:
                value["tool_calls"] = [
                    {
                        **call,
                        "function": {
                            **call["function"],
                            "arguments": json.loads(call["function"]["arguments"]),
                        },
                    }
                    for call in value["tool_calls"]
                ]
            messages.append(value)
        rendered = tokenizer.apply_chat_template(
            messages,
            tools=payload["tools"] or None,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        count = len(tokenizer.encode(rendered))
        revision = str(getattr(tokenizer, "name_or_path", session.model_id))
        template_revision = schema_digest(template)
    budget = ContextBudget(
        session.context_limit,
        count,
        payload["max_tokens"],
        measurement="exact",
        tokenizerRevision=revision,
        templateRevision=template_revision,
        toolSchemaDigest=schema_digest(payload["tools"]),
    )
    if count + budget.outputReserve + budget.safetyReserve > budget.contextLimit:
        fixed_messages = [item for item in payload["messages"] if item["role"] == "system"]
        fixed_messages.append({"role": "user", "content": ""})
        if session.engine == "fake":
            fixed_tokens = len(
                json.dumps(
                    {"messages": fixed_messages, "tools": payload["tools"]}, ensure_ascii=False
                )
            )
        else:
            fixed_prompt = tokenizer.apply_chat_template(
                fixed_messages,
                tools=payload["tools"] or None,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False,
            )
            fixed_tokens = len(tokenizer.encode(fixed_prompt))
        raise ContextOverflow(
            {**budget.to_dict(), "fixedInputTokens": fixed_tokens},
            fixed_tokens + budget.outputReserve + budget.safetyReserve > budget.contextLimit,
        )
    return rendered, parser, budget.to_dict()
