"""Speech API, media privacy, persistence, submission and cancellation regression tests."""

import asyncio
import io
import struct
import tempfile
import time
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.audio_files import inspect_wav
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.jobs import JobState
from mlx_studio_runtime.domain.speech import SpeechParameters
from runtime_fixtures import create_test_app as create_app
from runtime_fixtures import create_test_runtime

RUNTIME_SOURCE = Path(__file__).parents[1] / "services/runtime/src"
HEADERS = {"Authorization": "Bearer audio-test"}
REQUEST = {
    "clientRequestId": "audio-1",
    "modelId": "builtin-fake-audio",
    "mode": "preset",
    "speaker": "demo",
    "text": "这是语音工作室的测试。",
    "language": "zh",
}


def wav_bytes(silent=False, seconds=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(
            struct.pack("<h", 0 if silent else 1000) * int(24000 * seconds)
        )
    return output.getvalue()


def wait_job(client, job_id, states=("succeeded", "failed", "cancelled")):
    for _ in range(200):
        job = client.get(
            f"/internal/v1/audio-generations/{job_id}", headers=HEADERS
        ).json()
        if job["state"] in states:
            return job
        time.sleep(0.02)
    raise AssertionError("Audio job did not converge")


class AudioApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = Path(self.directory.name) / "app.db"
        self.app = create_app("audio-test", self.database)
        self.client = TestClient(self.app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def upload(self):
        response = self.client.post(
            "/internal/v1/audio-assets?filename=test.wav",
            content=wav_bytes(),
            headers=HEADERS,
        )
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("relative_path", response.json())
        return response.json()

    def voice(self):
        asset = self.upload()
        response = self.client.post(
            "/internal/v1/voices",
            headers=HEADERS,
            json={
                "name": "测试参考音色",
                "reference_asset_id": asset["id"],
                "reference_text": "测试参考原文",
                "language": "zh",
                "source": "self",
                "consent": True,
            },
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_preset_produces_wav_auth_history_and_request_conflict(self):
        self.assertEqual(
            self.client.get("/internal/v1/audio-artifacts").status_code, 401
        )
        response = self.client.post(
            "/internal/v1/audio-generations", json=REQUEST, headers=HEADERS
        )
        self.assertEqual(response.status_code, 202)
        identifier = response.json()["id"]
        duplicate = self.client.post(
            "/internal/v1/audio-generations", json=REQUEST, headers=HEADERS
        )
        self.assertEqual(duplicate.json()["id"], identifier)
        conflict = self.client.post(
            "/internal/v1/audio-generations",
            json=dict(REQUEST, text="其他文字"),
            headers=HEADERS,
        )
        self.assertEqual(conflict.status_code, 409)
        job = wait_job(self.client, identifier)
        self.assertEqual(job["state"], "succeeded")
        history = self.client.get(
            "/internal/v1/audio-artifacts", headers=HEADERS
        ).json()
        self.assertEqual(len(history), 1)
        artifact = history[0]
        self.assertTrue(artifact["simulated"])
        self.assertNotIn("requestDigest", artifact)
        detail_url = f"/internal/v1/audio-artifacts/{artifact['id']}"
        self.assertEqual(self.client.get(detail_url).status_code, 401)
        detail = self.client.get(detail_url, headers=HEADERS)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json(), artifact)
        self.assertEqual(
            self.client.get(
                "/internal/v1/audio-artifacts?offset=24", headers=HEADERS
            ).json(),
            [],
        )
        self.assertNotIn("relative_path", detail.json())
        self.assertEqual(
            self.client.get(
                "/internal/v1/audio-artifacts/missing", headers=HEADERS
            ).status_code,
            404,
        )
        url = f"/internal/v1/audio-artifacts/{artifact['id']}/content"
        self.assertEqual(self.client.get(url).status_code, 401)
        content = self.client.get(url, headers=HEADERS)
        self.assertEqual(content.headers["content-type"], "audio/wav")
        metadata = inspect_wav(content.content, 600)
        self.assertEqual(metadata["sample_rate"], artifact["sample_rate"])
        self.assertAlmostEqual(
            artifact["rtf"], artifact["elapsed_seconds"] / artifact["duration_seconds"]
        )
        self.assertEqual(
            self.client.delete(
                f"/internal/v1/audio-artifacts/{artifact['id']}", headers=HEADERS
            ).status_code,
            204,
        )
        self.assertEqual(self.client.get(url, headers=HEADERS).status_code, 404)
        self.assertEqual(self.client.get(detail_url, headers=HEADERS).status_code, 404)
        self.assertEqual(
            list(
                (self.app.state.service.store.media_path / "audio/generated").glob(
                    "*.wav"
                )
            ),
            [],
        )

    def test_clone_and_default_profile_deletion_preserve_frozen_queued_input(self):
        voice = self.voice()
        self.assertEqual(
            self.client.delete(
                f"/internal/v1/audio-assets/{voice['reference_asset_id']}",
                headers=HEADERS,
            ).status_code,
            409,
        )
        request = dict(REQUEST, mode="clone", voiceId=voice["id"])
        del request["speaker"]
        lock = self.app.state.service.scheduler.lock
        self.client.portal.call(lock.acquire)
        try:
            job = self.client.post(
                "/internal/v1/audio-generations", json=request, headers=HEADERS
            ).json()
            blocked = self.client.delete(
                f"/internal/v1/voices/{voice['id']}?delete_reference=true",
                headers=HEADERS,
            )
            self.assertEqual(blocked.status_code, 409)
            renamed = self.client.patch(
                f"/internal/v1/voices/{voice['id']}",
                headers=HEADERS,
                json={"name": "新版", "reference_text": "新版原文"},
            ).json()
            self.assertEqual(renamed["version"], 2)
            self.assertEqual(
                self.client.delete(
                    f"/internal/v1/voices/{voice['id']}", headers=HEADERS
                ).status_code,
                204,
            )
            duplicate = self.client.post(
                "/internal/v1/audio-generations", json=request, headers=HEADERS
            )
            self.assertEqual(duplicate.json()["id"], job["id"])
        finally:
            self.client.portal.call(lock.release)
        final = wait_job(self.client, job["id"])
        self.assertEqual(final["state"], "succeeded")
        self.assertEqual(final["voice_snapshot"], voice)
        self.assertEqual(
            self.client.get("/internal/v1/voices", headers=HEADERS).json(), []
        )
        self.assertEqual(
            self.client.delete(
                f"/internal/v1/audio-assets/{voice['reference_asset_id']}",
                headers=HEADERS,
            ).status_code,
            204,
        )
        self.assertEqual(
            self.client.get(
                f"/internal/v1/audio-artifacts/{final['artifact_id']}/content",
                headers=HEADERS,
            ).status_code,
            200,
        )

    def test_complete_voice_deletion_removes_source_and_retains_artifacts(self):
        voice = self.voice()
        response = self.client.delete(
            f"/internal/v1/voices/{voice['id']}?delete_reference=true", headers=HEADERS
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(
            self.client.get(
                f"/internal/v1/audio-assets/{voice['reference_asset_id']}/content",
                headers=HEADERS,
            ).status_code,
            404,
        )

    def test_rejects_unsupported_modes_parameters_models_and_bad_audio(self):
        for invalid in (
            {"speaker": None},
            {"mode": "design"},
            {"voiceId": "voice"},
            {"speed": 2},
            {"text": "  "},
            {"output": {"format": "mp3"}},
        ):
            with self.subTest(invalid=invalid):
                self.assertEqual(
                    self.client.post(
                        "/internal/v1/audio-generations",
                        json=dict(REQUEST, **invalid),
                        headers=HEADERS,
                    ).status_code,
                    422,
                )
        self.assertEqual(
            self.client.post(
                "/internal/v1/audio-generations",
                json=dict(REQUEST, modelId="builtin-fake-text"),
                headers=HEADERS,
            ).status_code,
            400,
        )
        for content, code in (
            (b"ID3notwav", "AUDIO_FORMAT_UNSUPPORTED"),
            (wav_bytes()[:-2], "AUDIO_INVALID"),
            (wav_bytes(True), "AUDIO_SILENT"),
            (wav_bytes(seconds=31), "AUDIO_INVALID"),
        ):
            response = self.client.post(
                "/internal/v1/audio-assets", content=content, headers=HEADERS
            )
            self.assertEqual(response.json()["error"]["code"], code)
        for path in ("voices", "audio-assets", "audio-generations"):
            self.assertEqual(
                self.client.post(
                    f"/internal/v1/{path}", headers={}, json={}
                ).status_code,
                401,
            )

    def test_queued_and_running_cancel_then_shared_text_worker_switch(self):
        lock = self.app.state.service.scheduler.lock
        self.client.portal.call(lock.acquire)
        try:
            response = self.client.post(
                "/internal/v1/audio-generations", json=REQUEST, headers=HEADERS
            )
            job_id = response.json()["id"]
            self.client.post(
                f"/internal/v1/audio-generations/{job_id}/cancel", headers=HEADERS
            )
            self.assertEqual(wait_job(self.client, job_id)["state"], "cancelled")
        finally:
            self.client.portal.call(lock.release)
        response = self.client.post(
            "/internal/v1/audio-generations",
            json=dict(REQUEST, clientRequestId="running"),
            headers=HEADERS,
        )
        job_id = response.json()["id"]
        wait_job(self.client, job_id, ("running",))
        self.client.post(
            f"/internal/v1/audio-generations/{job_id}/cancel", headers=HEADERS
        )
        self.assertEqual(wait_job(self.client, job_id)["state"], "cancelled")
        self.assertEqual(
            self.client.get("/internal/v1/audio-artifacts", headers=HEADERS).json(), []
        )
        self.assertEqual(
            self.client.post(
                "/internal/v1/models/builtin-fake-text/load", headers=HEADERS
            ).status_code,
            200,
        )
        response = self.client.post(
            "/internal/v1/audio-generations",
            json=dict(REQUEST, clientRequestId="after-switch"),
            headers=HEADERS,
        )
        self.assertEqual(
            wait_job(self.client, response.json()["id"])["state"], "succeeded"
        )


class AudioConsistencyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = Path(self.directory.name) / "app.db"
        self.service = create_test_runtime(
            SQLiteRepositories(self.database), RUNTIME_SOURCE
        )
        self.parameters = SpeechParameters(
            "builtin-fake-audio", "preset", "hello", "auto", "demo"
        )

    async def asyncTearDown(self):
        await self.service.close()
        self.directory.cleanup()

    async def test_artifact_transaction_failure_removes_files_and_asset_rows(self):
        with patch.object(
            self.service.store.audio, "save_artifact", side_effect=OSError("disk full")
        ):
            job = await self.service.speech.create(self.parameters, "fail-registration")
            await self.service.scheduler.tasks[job["id"]]
        self.assertEqual(self.service.lifecycle.items[job["id"]].state, JobState.FAILED)
        self.assertEqual(self.service.store.audio.artifacts(24, 0), [])
        self.assertEqual(
            self.service.store.database.connection.execute(
                "SELECT count(*) FROM audio_assets"
            ).fetchone()[0],
            0,
        )
        self.assertEqual(
            list((self.service.store.media_path / "audio/generated").glob("*.wav")), []
        )

    async def test_late_worker_completion_after_cancel_cannot_publish_artifact(self):
        class RaceWorker:
            def __init__(self):
                self.release = asyncio.Event()

            async def generate_audio(self, job_id, parameters, output):
                await self.release.wait()
                output.write_bytes(wav_bytes())
                yield {"type": "generation.completed", "payload": {"job_id": job_id}}

            async def cancel(self, job_id):
                self.release.set()

            async def stop(self):
                self.release.set()

        self.service.inference.worker = RaceWorker()
        self.service.inference.active_model_id = "builtin-fake-audio"
        job = await self.service.speech.create(self.parameters, "race")
        await asyncio.sleep(0)
        await self.service.scheduler.cancel(job["id"])
        self.assertEqual(
            self.service.lifecycle.items[job["id"]].state, JobState.CANCELLED
        )
        self.assertEqual(self.service.store.audio.artifacts(24, 0), [])
        self.assertEqual(
            list((self.service.store.media_path / "audio/staging").glob("*.wav")), []
        )

    async def test_worker_crash_fails_task_and_releases_shared_lease(self):
        class BrokenWorker:
            async def generate_audio(self, job_id, parameters, output):
                output.write_bytes(b"partial")
                raise RuntimeError("transport failed")
                yield

            async def stop(self):
                return

        self.service.inference.worker = BrokenWorker()
        self.service.inference.active_model_id = "builtin-fake-audio"
        job = await self.service.speech.create(self.parameters, "crash")
        await self.service.scheduler.tasks[job["id"]]
        self.assertEqual(self.service.lifecycle.items[job["id"]].state, JobState.FAILED)
        self.assertIsNone(self.service.inference.worker)
        self.assertFalse(self.service.scheduler.lock.locked())
        self.assertEqual(
            list((self.service.store.media_path / "audio/staging").glob("*.wav")), []
        )

    async def test_restart_persists_history_and_quarantines_only_unregistered_media(
        self,
    ):
        job = await self.service.speech.create(self.parameters, "persist")
        await self.service.scheduler.tasks[job["id"]]
        artifact = self.service.store.audio.artifacts(24, 0)[0]
        media = self.service.store.media_path
        pending = media / "audio/staging" / f"{uuid.uuid4()}.wav"
        pending.write_bytes(wav_bytes())
        self.service.store.jobs.save(
            {"id": "interrupted", "kind": "audio", "state": "running", "request": {}}
        )
        await self.service.close()
        self.service = create_test_runtime(
            SQLiteRepositories(self.database), RUNTIME_SOURCE
        )
        self.assertEqual(self.service.store.audio.artifacts(24, 0)[0], artifact)
        self.assertTrue(self.service.speech.content(artifact["id"]).is_file())
        self.assertEqual(
            self.service.speech.get_job("interrupted")["error_code"],
            "RUNTIME_RESTARTED",
        )
        self.assertFalse(pending.exists())
        self.assertTrue((media / ".recovery/audio/staging" / pending.name).is_file())
