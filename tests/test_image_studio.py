import asyncio
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

RUNTIME_SOURCE = Path(__file__).parents[1] / "services" / "runtime" / "src"
sys.path.insert(0, str(RUNTIME_SOURCE))

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.image_engines.fake_image import write_fake_png
from mlx_studio_runtime.adapters.image_files import artifact_path, validate_png
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.image_generation import ImageParameters
from mlx_studio_runtime.domain.jobs import JobState
from runtime_fixtures import create_test_app as create_app
from runtime_fixtures import create_test_runtime

PARAMETERS = {
    "model_id": "builtin-fake-image",
    "prompt": "A quiet mountain lake",
    "width": 80,
    "height": 64,
    "steps": 2,
    "seed": 0,
}
HEADERS = {"Authorization": "Bearer image-test"}


def wait_for_job(client, job_id, terminal=True):
    for _ in range(200):
        result = client.get(f"/internal/v1/image-jobs/{job_id}", headers=HEADERS)
        if result.json()["state"] in (
            {"succeeded", "failed", "cancelled"} if terminal else {"running"}
        ):
            return result.json()
        time.sleep(0.02)
    raise AssertionError("Image job never reached expected state")


class ImageStudioApiTests(unittest.TestCase):
    def test_generate_png_gallery_auth_and_restart_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "app.db"
            with TestClient(create_app("image-test", database)) as client:
                self.assertEqual(
                    client.get("/internal/v1/image-artifacts").status_code, 401
                )
                created = client.post(
                    "/internal/v1/image-jobs", json=PARAMETERS, headers=HEADERS
                )
                self.assertEqual(created.status_code, 200)
                job = wait_for_job(client, created.json()["id"])
                self.assertEqual(job["state"], "succeeded")
                self.assertEqual(job["progress"], 100)
                history = client.get(
                    "/internal/v1/image-artifacts", headers=HEADERS
                ).json()
                self.assertEqual(len(history), 1)
                artifact = history[0]
                self.assertTrue(artifact["simulated"])
                self.assertEqual((artifact["seed"], artifact["steps"]), (0, 2))
                self.assertEqual(artifact["prompt"], PARAMETERS["prompt"])
                self.assertNotIn("relative_path", artifact)
                url = f"/internal/v1/image-artifacts/{artifact['id']}/content"
                self.assertEqual(client.get(url).status_code, 401)
                content = client.get(url, headers=HEADERS)
                self.assertEqual(content.headers["content-type"], "image/png")
                self.assertTrue(content.content.startswith(b"\x89PNG\r\n\x1a\n"))
                image = Path(directory) / "media" / "images" / f"{artifact['id']}.png"
                validate_png(image, 80, 64)
            with TestClient(create_app("image-test", database)) as reopened:
                self.assertEqual(
                    reopened.get(
                        "/internal/v1/image-artifacts", headers=HEADERS
                    ).json(),
                    history,
                )
                self.assertEqual(
                    reopened.get(url, headers=HEADERS).content, content.content
                )

    def test_detail_reads_beyond_first_page_and_filters_private_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app("image-test", Path(directory) / "app.db")
            with TestClient(app) as client:
                created = client.post(
                    "/internal/v1/image-jobs", json=PARAMETERS, headers=HEADERS
                )
                job = wait_for_job(client, created.json()["id"])
                original = app.state.service.store.images.get(job["artifact_id"])
                for index in range(25):
                    app.state.service.store.images.save(
                        f"detail-{index}", job["id"], "missing.png", dict(original)
                    )
                url = "/internal/v1/image-artifacts/detail-0"
                self.assertEqual(client.get(url).status_code, 401)
                page = client.get(
                    "/internal/v1/image-artifacts?limit=24", headers=HEADERS
                ).json()
                self.assertNotIn("detail-0", [item["id"] for item in page])
                response = client.get(url, headers=HEADERS)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["id"], "detail-0")
                self.assertNotIn("relative_path", response.json())
                self.assertEqual(
                    client.get(
                        "/internal/v1/image-artifacts/missing", headers=HEADERS
                    ).status_code,
                    404,
                )

    def test_cancel_creates_no_artifact_and_next_job_can_succeed(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            TestClient(create_app("image-test", Path(directory) / "app.db")) as client,
        ):
            result = client.post(
                "/internal/v1/image-jobs",
                json=dict(PARAMETERS, steps=100),
                headers=HEADERS,
            )
            job_id = result.json()["id"]
            wait_for_job(client, job_id, terminal=False)
            client.post(f"/internal/v1/image-jobs/{job_id}/cancel", headers=HEADERS)
            self.assertEqual(wait_for_job(client, job_id)["state"], "cancelled")
            self.assertEqual(
                client.get("/internal/v1/image-artifacts", headers=HEADERS).json(),
                [],
            )
            again = client.post(
                "/internal/v1/image-jobs", json=PARAMETERS, headers=HEADERS
            )
            self.assertEqual(
                wait_for_job(client, again.json()["id"])["state"], "succeeded"
            )

    def test_rejects_invalid_parameters_text_models_and_cross_kind_cancellation(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            TestClient(create_app("image-test", Path(directory) / "app.db")) as client,
        ):
            for invalid in (
                {"width": 81},
                {"height": None},
                {"seed": -1},
                {"prompt": "   "},
            ):
                response = client.post(
                    "/internal/v1/image-jobs",
                    json=dict(PARAMETERS, **invalid),
                    headers=HEADERS,
                )
                self.assertEqual(response.status_code, 422)
            wrong = client.post(
                "/internal/v1/image-jobs",
                json=dict(PARAMETERS, model_id="builtin-fake-text"),
                headers=HEADERS,
            )
            self.assertEqual(wrong.status_code, 400)
            self.assertEqual(wrong.json()["error"]["code"], "IMAGE_MODEL_INVALID")
            self.assertEqual(
                client.post(
                    "/internal/v1/image-jobs/missing/cancel", headers=HEADERS
                ).status_code,
                404,
            )

    def test_failed_model_load_reaches_terminal_state(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app("image-test", Path(directory) / "app.db")
            with (
                TestClient(app) as client,
                patch(
                    "mlx_studio_runtime.composition_root.WorkerHost.load",
                    new=AsyncMock(
                        side_effect=RuntimeError("optional engine unavailable")
                    ),
                ),
            ):
                response = client.post(
                    "/internal/v1/image-jobs", json=PARAMETERS, headers=HEADERS
                )
                job = wait_for_job(client, response.json()["id"])
                self.assertEqual(
                    (job["state"], job["error_code"]), ("failed", "MODEL_LOAD_FAILED")
                )
                self.assertEqual(
                    client.get("/internal/v1/image-artifacts", headers=HEADERS).json(),
                    [],
                )

    def test_interrupted_tasks_are_failed_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "app.db"
            store = SQLiteRepositories(database)
            request = dict(PARAMETERS, model_name="Development", simulated=True)
            store.jobs.save(
                {
                    "id": "interrupted",
                    "kind": "image",
                    "state": "running",
                    "request": request,
                }
            )
            store.close()
            with TestClient(create_app("image-test", database)) as client:
                job = client.get(
                    "/internal/v1/image-jobs/interrupted", headers=HEADERS
                ).json()
                self.assertEqual(
                    (job["state"], job["error_code"]), ("failed", "RUNTIME_RESTARTED")
                )
                self.assertEqual(job["seed"], 0)


class ImageTaskConsistencyTests(unittest.TestCase):
    def test_queued_cancellation_finishes_without_waiting_for_the_active_task(self):
        asyncio.run(self._queued_cancellation())

    async def _queued_cancellation(self):
        with tempfile.TemporaryDirectory() as directory:
            service = create_test_runtime(
                SQLiteRepositories(Path(directory) / "app.db"), RUNTIME_SOURCE
            )
            await service.scheduler.lock.acquire()
            try:
                job = await service.images.create(ImageParameters(**PARAMETERS))
                await asyncio.sleep(0)
                result = await service.scheduler.cancel(job["id"])
                self.assertEqual(result["state"], "cancelled")
                self.assertIsNone(service.inference.worker)
            finally:
                service.scheduler.lock.release()
                await service.close()

    def test_late_completion_after_cancel_does_not_save_an_image(self):
        asyncio.run(self._late_completion())

    async def _late_completion(self):
        class RaceWorker:
            def __init__(self):
                self.release = asyncio.Event()

            async def generate_image(self, job_id, parameters, output):
                await self.release.wait()
                write_fake_png(
                    output,
                    parameters["width"],
                    parameters["height"],
                    parameters["seed"],
                )
                yield {"type": "generation.completed", "payload": {"job_id": job_id}}

            async def cancel(self, _job_id):
                self.release.set()

            async def stop(self):
                self.release.set()

        with tempfile.TemporaryDirectory() as directory:
            service = create_test_runtime(
                SQLiteRepositories(Path(directory) / "app.db"), RUNTIME_SOURCE
            )
            service.inference.worker = RaceWorker()
            service.inference.active_model_id = "builtin-fake-image"
            result = await service.images.create(ImageParameters(**PARAMETERS))
            await asyncio.sleep(0)
            await service.scheduler.cancel(result["id"])
            self.assertEqual(
                service.lifecycle.items[result["id"]].state, JobState.CANCELLED
            )
            self.assertEqual(service.store.images.list_artifacts(), [])
            self.assertEqual(
                list((service.store.media_path / "images").glob("*.png")), []
            )
            await service.close()

    def test_artifact_registration_failure_removes_the_completed_file(self):
        asyncio.run(self._registration_failure())

    async def _registration_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            service = create_test_runtime(
                SQLiteRepositories(Path(directory) / "app.db"), RUNTIME_SOURCE
            )
            with patch.object(
                service.store.images, "save", side_effect=RuntimeError("disk full")
            ):
                result = await service.images.create(ImageParameters(**PARAMETERS))
                await service.scheduler.tasks[result["id"]]
            self.assertEqual(
                service.lifecycle.items[result["id"]].state, JobState.FAILED
            )
            self.assertEqual(
                list((service.store.media_path / "images").glob("*.png")), []
            )
            self.assertEqual(service.store.images.list_artifacts(), [])
            await service.close()


class ImageFileTests(unittest.TestCase):
    def test_png_validation_rejects_wrong_dimensions_corruption_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "test.png"
            write_fake_png(output, 80, 64, 0)
            validate_png(output, 80, 64)
            with self.assertRaises(ValueError):
                validate_png(output, 64, 64)
            output.write_bytes(output.read_bytes()[:-5])
            with self.assertRaises(ValueError):
                validate_png(output, 80, 64)
            with self.assertRaises(ValueError):
                artifact_path(root, "../secret.png")
