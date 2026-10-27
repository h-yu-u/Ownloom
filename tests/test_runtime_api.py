import io
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "runtime" / "src"))

from fastapi.testclient import TestClient
from runtime_fixtures import create_test_app as create_app


class RuntimeApiTests(unittest.TestCase):
    def test_live_memory_tracks_worker_load_and_unload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_app("metrics-test", Path(directory) / "app.db")
            with TestClient(
                app, headers={"Authorization": "Bearer metrics-test"}
            ) as client:
                before = client.get("/internal/v1/runtime/metrics")
                self.assertEqual(before.status_code, 200)
                self.assertEqual(before.json()["worker_memory_bytes"], 0)
                loaded = client.post("/internal/v1/models/builtin-fake-text/load")
                self.assertEqual(loaded.status_code, 200)
                sample = client.get("/internal/v1/runtime/metrics").json()
                self.assertGreater(sample["worker_memory_bytes"], 0)
                self.assertGreater(sample["system_memory_total_bytes"], 0)
                self.assertEqual(
                    sample["system_memory_total_bytes"],
                    sample["system_memory_used_bytes"]
                    + sample["system_memory_available_bytes"],
                )
                unloaded = client.post("/internal/v1/models/builtin-fake-text/unload")
                self.assertEqual(unloaded.status_code, 200)
                self.assertEqual(
                    client.get("/internal/v1/runtime/metrics").json()[
                        "worker_memory_bytes"
                    ],
                    0,
                )

    def test_auth_chat_persistence_and_external_api_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_app("test-session-token", Path(directory) / "app.db")
            with TestClient(app) as client:
                denied = client.get("/internal/v1/runtime/health")
                self.assertEqual(denied.status_code, 401)
                headers = {"Authorization": "Bearer test-session-token"}
                health = client.get("/internal/v1/runtime/health", headers=headers)
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()["protocol_version"], 1)
                allowed_origin = client.get(
                    "/internal/v1/runtime/health",
                    headers={**headers, "Origin": "tauri://localhost"},
                )
                self.assertEqual(
                    allowed_origin.headers["access-control-allow-origin"],
                    "tauri://localhost",
                )
                blocked_origin = client.get(
                    "/internal/v1/runtime/health",
                    headers={**headers, "Origin": "https://example.com"},
                )
                self.assertNotIn("access-control-allow-origin", blocked_origin.headers)
                self.assertEqual(
                    client.get("/v1/models", headers=headers).status_code, 404
                )
                from PIL import Image

                image_buffer = io.BytesIO()
                Image.new("RGB", (1, 1)).save(image_buffer, "PNG")
                png = image_buffer.getvalue()
                attachment = client.post(
                    "/internal/v1/attachments?filename=../../private.png",
                    headers=headers,
                    content=png,
                )
                self.assertEqual(attachment.status_code, 200)
                attachment_id = attachment.json()["id"]
                self.assertEqual(attachment.json()["originalName"], "private.png")
                self.assertEqual(
                    client.get(
                        f"/internal/v1/attachments/{attachment_id}", headers=headers
                    ).content,
                    png,
                )

                created = client.post(
                    "/internal/v1/conversations",
                    headers=headers,
                    json={"title": "Test", "model_id": "builtin-fake-text"},
                )
                conversation_id = created.json()["id"]
                sent = client.post(
                    f"/internal/v1/conversations/{conversation_id}/messages",
                    headers=headers,
                    json={
                        "content": "say hi",
                        "model_id": "builtin-fake-text",
                        "max_tokens": 20,
                    },
                )
                self.assertEqual(sent.status_code, 200)
                job_id = sent.json()["jobId"]
                sent_again = client.post(
                    f"/internal/v1/conversations/{conversation_id}/messages",
                    headers=headers,
                    json={
                        "content": "follow up",
                        "model_id": "builtin-fake-text",
                        "max_tokens": 20,
                    },
                )
                self.assertEqual(sent_again.status_code, 409)
                self.assertEqual(
                    sent_again.json()["error"]["code"], "CONVERSATION_BUSY"
                )
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    first_job = client.get(
                        f"/internal/v1/jobs/{job_id}", headers=headers
                    ).json()
                    if first_job["state"] in {"succeeded", "failed", "cancelled"}:
                        break
                    time.sleep(0.03)
                sent_again = client.post(
                    f"/internal/v1/conversations/{conversation_id}/messages",
                    headers=headers,
                    json={
                        "content": "follow up",
                        "model_id": "builtin-fake-text",
                        "max_tokens": 20,
                    },
                )
                self.assertEqual(sent_again.status_code, 200)
                second_job_id = sent_again.json()["jobId"]
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    jobs = client.get("/internal/v1/jobs", headers=headers).json()
                    job_states = {item["id"]: item["state"] for item in jobs}
                    if all(
                        job_states.get(item) in {"succeeded", "failed", "cancelled"}
                        for item in (job_id, second_job_id)
                    ):
                        break
                    time.sleep(0.03)
                conversation = client.get(
                    f"/internal/v1/conversations/{conversation_id}", headers=headers
                ).json()
                self.assertEqual(
                    [item["role"] for item in conversation["messages"]],
                    ["user", "assistant", "user", "assistant"],
                )
                self.assertIn("FakeEngine", conversation["messages"][1]["content"])
                unsupported = client.post(
                    f"/internal/v1/conversations/{conversation_id}/messages",
                    headers=headers,
                    json={
                        "content": "describe",
                        "model_id": "builtin-fake-text",
                        "attachment_ids": [attachment_id],
                    },
                )
                self.assertEqual(unsupported.status_code, 400)
                self.assertEqual(
                    unsupported.json()["error"]["code"], "MODEL_INPUT_UNSUPPORTED"
                )

                bundle = client.get(
                    "/internal/v1/runtime/diagnostics/bundle", headers=headers
                )
                self.assertEqual(bundle.status_code, 200)
                with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
                    report = archive.read("diagnostics.json").decode()
                    self.assertNotIn("test-session-token", report)
                    self.assertNotIn("active_model_id", report)


if __name__ == "__main__":
    unittest.main()
