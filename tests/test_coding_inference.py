"""Boundary contracts for tool context, scoped auth and native parser failures."""

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.text_engines.session import normalize_messages
from mlx_studio_runtime.adapters.text_engines.structured import parse_completion
from mlx_studio_runtime.domain.inference import validate_context
from runtime_fixtures import create_test_app as create_app

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    }
]


class CodingInferenceTests(unittest.TestCase):
    def test_context_preserves_tool_ids_and_rejects_invalid_history(self):
        call = {
            "id": "c",
            "type": "function",
            "function": {"name": "read", "arguments": '{"path":"中文.txt"}'},
        }
        messages = [
            {"role": "assistant", "tool_calls": [call]},
            {"role": "tool", "tool_call_id": "c", "content": "结果"},
        ]
        validate_context(messages, TOOLS)
        validate_context(messages, [])  # Mode changes may remove historical tools.
        for invalid in [
            messages[:1],
            [messages[1]],
            messages + messages,
            [{"role": "user", "tool_calls": [call]}],
        ]:
            with self.assertRaises(ValueError):
                validate_context(invalid, TOOLS)
        with self.assertRaises(ValueError):
            normalize_messages(messages, "must not replace context")

    def test_native_json_xml_unicode_and_truncation(self):
        text = '<tool_call>{"name":"read","arguments":{"path":"中文.txt"}}</tool_call>'
        result = parse_completion(text, TOOLS, "stop")
        self.assertEqual(result["finish_reason"], "tool_calls")
        call = result["message"]["tool_calls"][0]
        self.assertTrue(call["id"])
        self.assertEqual(
            json.loads(call["function"]["arguments"]), {"path": "中文.txt"}
        )
        xml = "<tool_call>\n<function=read>\n<parameter=path>\n中文.txt\n</parameter>\n</function>\n</tool_call>"
        self.assertEqual(
            parse_completion(xml, TOOLS, "stop", "qwen-xml")["finish_reason"],
            "tool_calls",
        )
        for invalid, reason in [
            (text, "length"),
            (text[:-12], "stop"),
            (text.replace('"read"', '"missing"'), "stop"),
            (text.replace('{"path":"中文.txt"}', '"partial"'), "stop"),
            (text + text[:-12], "stop"),
            (text + "</tool_call>", "stop"),
            (text * 49, "stop"),
        ]:
            with self.assertRaises(ValueError):
                parse_completion(invalid, TOOLS, reason)

    def test_multiple_calls_preserve_order_ids_and_validate_the_whole_batch(self):
        for parser, first, second in [
            (
                "json",
                '{"name":"read","arguments":{"path":"first.txt"}}',
                '{"name":"read","arguments":{"path":"第二.txt"}}',
            ),
            (
                "qwen-xml",
                "<function=read><parameter=path>first.txt</parameter></function>",
                "<function=read><parameter=path>第二.txt</parameter></function>",
            ),
        ]:
            text = f"检查两个文件。<tool_call>{first}</tool_call>\n<tool_call>{second}</tool_call>"
            result = parse_completion(text, TOOLS, "stop", parser)
            calls = result["message"]["tool_calls"]
            self.assertEqual(len({call["id"] for call in calls}), 2)
            self.assertEqual(
                [json.loads(c["function"]["arguments"])["path"] for c in calls],
                ["first.txt", "第二.txt"],
            )
            validate_context(
                [
                    result["message"],
                    *[
                        {"role": "tool", "tool_call_id": c["id"], "content": "ok"}
                        for c in calls
                    ],
                ],
                TOOLS,
            )
            with self.assertRaises(ValueError):
                parse_completion(
                    text.replace("第二.txt", "second").replace("read", "missing", 1),
                    TOOLS,
                    "stop",
                    parser,
                )

    def test_scoped_inference_credential_has_no_coding_or_model_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app("desktop", Path(directory) / "app.db")
            with TestClient(app) as client:
                token = app.state.service.coding.issue()
                headers = {"Authorization": f"Bearer {token}"}
                self.assertEqual(
                    client.get(
                        "/internal/v1/inference/models", headers=headers
                    ).status_code,
                    200,
                )
                self.assertEqual(
                    client.get(
                        "/internal/v1/coding/projects", headers=headers
                    ).status_code,
                    401,
                )
                self.assertEqual(
                    client.delete(
                        "/internal/v1/models/builtin-fake-text/registration",
                        headers=headers,
                    ).status_code,
                    401,
                )
                app.state.service.coding.credentials[token] = 0
                self.assertEqual(
                    client.get(
                        "/internal/v1/inference/models", headers=headers
                    ).status_code,
                    401,
                )
                invalid = client.post(
                    "/internal/v1/inference/chat/completions",
                    headers={"Authorization": "Bearer desktop"},
                    json={
                        "model": "builtin-fake-text",
                        "messages": [{"role": "developer", "content": "unsupported"}],
                    },
                )
                self.assertEqual(invalid.status_code, 422)
