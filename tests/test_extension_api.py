"""Product API uses one Host catalog, immutable Skill previews and separate secret injection."""

import json
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from runtime_fixtures import create_test_app

HEADERS = {"Authorization": "Bearer extensions-test"}
ROOT = "/internal/v1/extensions"


class MemorySecrets:
    def __init__(self):
        self.values = {}
        self.reads = 0

    def find(self, reference):
        self.reads += 1
        return self.values.get(reference)

    def resolve(self, reference):
        return self.values[reference]

    def set(self, reference, value):
        self.values[reference] = value

    def delete(self, reference):
        self.values.pop(reference, None)


class ExtensionApiTests(unittest.TestCase):
    def test_revoked_scope_cannot_fall_back_to_unrestricted_inference_after_auth(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_test_app("extensions-test", Path(directory) / "app.db")
            calls = 0

            def scoped_once(authorization):
                nonlocal calls
                calls += 1
                return calls == 1

            app.state.service.capability_grants.authorized = scoped_once
            with TestClient(app) as client:
                response = client.post(
                    "/internal/v1/inference/chat/completions",
                    headers={"Authorization": "Bearer expired-run-scope"},
                    json={
                        "model": "builtin-fake-text",
                        "messages": [{"role": "user", "content": "must not run"}],
                        "tools": [],
                        "max_tokens": 128,
                    },
                )
                self.assertNotEqual(response.status_code, 200)
                self.assertEqual(
                    response.json()["error"]["code"], "CAPABILITY_SCOPE_EXPIRED"
                )
                self.assertEqual(app.state.service.store.jobs.list(), [])

    def test_preview_publish_chat_skill_and_ordinary_text_assistant(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            source = path / "review-method"
            source.mkdir()
            body = "---\nname: review-method\ndescription: A text-only selected workflow\n---\nSELECTED_TEXT_SKILL_SENTINEL\n"
            (source / "SKILL.md").write_text(body)
            app = create_test_app("extensions-test", path / "app.db")
            captured = []
            original = app.state.service.inference.generate

            async def generate(*args, **kwargs):
                captured.append(args[5])
                async for event in original(*args, **kwargs):
                    yield event

            app.state.service.inference.generate = generate
            with TestClient(app) as client:
                self.assertEqual(client.get(ROOT + "/catalog").status_code, 401)
                catalog = client.get(ROOT + "/catalog", headers=HEADERS).json()
                self.assertEqual(len(catalog["skills"]), 2)
                request = {
                    "mutationId": "skill-import",
                    "path": str(source),
                    "workspaces": ["coding", "chat", "image", "audio"],
                    "requiredCapabilities": [],
                }
                preview = client.post(
                    ROOT + "/skills/preview", json=request, headers=HEADERS
                )
                self.assertEqual(preview.status_code, 200, preview.text)
                self.assertEqual(preview.json()["body"], body)
                self.assertEqual(
                    client.get(ROOT + "/catalog", headers=HEADERS).json()[
                        "catalogRevision"
                    ],
                    catalog["catalogRevision"],
                )
                published = client.post(
                    ROOT + "/skills/import",
                    json={
                        **request,
                        "expectedDigest": preview.json()["skill"]["digest"],
                    },
                    headers=HEADERS,
                )
                self.assertEqual(published.status_code, 200, published.text)
                selection = {"skillIds": [published.json()["targetId"]], "toolIds": []}
                conversation = client.post(
                    "/internal/v1/conversations",
                    json={"title": "skill chat", "model_id": "builtin-fake-text"},
                    headers=HEADERS,
                ).json()
                response = client.post(
                    f"/internal/v1/conversations/{conversation['id']}/messages",
                    json={
                        "content": "plain text question",
                        "model_id": "builtin-fake-text",
                        "max_tokens": 128,
                        "client_request_id": "chat-skill",
                        "selection": selection,
                    },
                    headers=HEADERS,
                )
                self.assertEqual(response.status_code, 200, response.text)
                for _ in range(200):
                    job = client.get(
                        f"/internal/v1/jobs/{response.json()['jobId']}", headers=HEADERS
                    ).json()
                    if job["state"] in {"succeeded", "failed", "cancelled"}:
                        break
                    time.sleep(0.01)
                self.assertEqual(job["state"], "succeeded", job)
                self.assertIn("SELECTED_TEXT_SKILL_SENTINEL", json.dumps(captured))
                assistant = client.post(
                    ROOT + "/assist",
                    json={
                        "submissionId": "assistant",
                        "workspace": "image",
                        "text": "a quiet lake",
                        "modelId": "builtin-fake-text",
                        "selection": selection,
                    },
                    headers=HEADERS,
                )
                self.assertEqual(assistant.status_code, 200, assistant.text)
                for _ in range(200):
                    draft = client.get(
                        ROOT + f"/assist/{assistant.json()['jobId']}", headers=HEADERS
                    ).json()
                    if draft["state"] in {"succeeded", "failed", "cancelled"}:
                        break
                    time.sleep(0.01)
                self.assertEqual(draft["state"], "succeeded", draft)
                self.assertTrue(draft["text"])
                self.assertEqual(
                    client.get("/internal/v1/image-artifacts", headers=HEADERS).json(),
                    [],
                )
                self.assertEqual(app.state.service.extensions.text_jobs, {})

    def test_credentials_are_versioned_retries_do_not_rewrite_and_catalog_is_redacted(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            app = create_test_app("extensions-test", Path(directory) / "app.db")
            secrets = MemorySecrets()
            app.state.service.extensions.secrets = secrets
            with TestClient(app) as client:
                request = {
                    "mutationId": "mcp-no-secret",
                    "expectedRevision": 0,
                    "name": "test-server",
                    "enabled": False,
                    "transport": {
                        "type": "streamable-http",
                        "url": "http://127.0.0.1:9/mcp",
                        "authMode": "none",
                        "publicHeaders": {},
                    },
                    "allowedTools": [],
                    "readOnlyTools": [],
                }
                saved = client.post(ROOT + "/mcp", json=request, headers=HEADERS)
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertEqual(secrets.reads, 0)
                server_id = saved.json()["targetId"]
                replacement = {
                    **request,
                    "mutationId": "credential",
                    "id": server_id,
                    "expectedRevision": 1,
                    "credential": {
                        "action": "replace",
                        "field": "Authorization",
                        "kind": "bearer",
                        "value": "private-example-secret",
                    },
                }
                saved = client.post(ROOT + "/mcp", json=replacement, headers=HEADERS)
                self.assertEqual(saved.status_code, 200, saved.text)
                retry = client.post(ROOT + "/mcp", json=replacement, headers=HEADERS)
                self.assertEqual(retry.json(), saved.json())
                self.assertEqual(len(secrets.values), 1)
                invalid = client.post(
                    ROOT + "/mcp",
                    json={
                        **replacement,
                        "mutationId": "wrong-transport-credential",
                        "credential": {**replacement["credential"], "kind": "env"},
                    },
                    headers=HEADERS,
                )
                self.assertEqual(
                    invalid.json()["error"]["code"], "INVALID_CREDENTIAL_FIELD"
                )
                self.assertEqual(len(secrets.values), 1)
                changed = client.post(
                    ROOT + "/mcp",
                    json={
                        **replacement,
                        "credential": {
                            **replacement["credential"],
                            "value": "different-secret",
                        },
                    },
                    headers=HEADERS,
                )
                self.assertEqual(changed.status_code, 409, changed.text)
                catalog = client.get(ROOT + "/catalog", headers=HEADERS)
                self.assertNotIn("private-example-secret", catalog.text)
                self.assertTrue(catalog.json()["servers"][0]["credentialConfigured"])
                self.assertEqual(
                    catalog.json()["servers"][0]["transport"]["secretRefs"],
                    {"Authorization": "configured"},
                )
                database = app.state.service.agent_host.directory / "extensions.db"
                self.assertNotIn(b"private-example-secret", database.read_bytes())
