import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "services/runtime/src"))

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.image_engines.fake_image import write_fake_png
from runtime_fixtures import create_test_app as create_app
from test_image_studio import HEADERS, PARAMETERS, wait_for_job


class ImageEditingTests(unittest.TestCase):
    def test_editing_keeps_order_mask_parameters_and_attachments_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            write_fake_png(source, 80, 64, 42)
            with TestClient(create_app("image-test", root / "app.db")) as client:
                ids = []
                for _ in range(3):
                    uploaded = client.post(
                        "/internal/v1/attachments?filename=source.png",
                        content=source.read_bytes(),
                        headers=HEADERS,
                    )
                    self.assertEqual(uploaded.status_code, 200)
                    ids.append(uploaded.json()["id"])
                request = dict(
                    PARAMETERS,
                    mode="inpaint",
                    reference_ids=ids[:2],
                    mask_id=ids[2],
                    strength=0.8,
                    client_request_id="edit-one",
                )
                created = client.post(
                    "/internal/v1/image-jobs", json=request, headers=HEADERS
                )
                self.assertEqual(created.status_code, 200)
                job = wait_for_job(client, created.json()["id"])
                self.assertEqual(job["state"], "succeeded")
                duplicate = client.post(
                    "/internal/v1/image-jobs", json=request, headers=HEADERS
                )
                self.assertEqual(duplicate.json()["id"], job["id"])
                gallery = client.get(
                    "/internal/v1/image-artifacts", headers=HEADERS
                ).json()
                self.assertEqual(gallery[0]["reference_ids"], ids[:2])
                self.assertEqual(gallery[0]["mask_id"], ids[2])
                self.assertEqual(gallery[0]["strength"], 0.8)
            with TestClient(create_app("image-test", root / "app.db")) as client:
                self.assertEqual(
                    client.get("/internal/v1/image-artifacts", headers=HEADERS).json(),
                    gallery,
                )
                for identifier in ids:
                    self.assertEqual(
                        client.get(
                            f"/internal/v1/attachments/{identifier}", headers=HEADERS
                        ).content,
                        source.read_bytes(),
                    )

    def test_invalid_edit_inputs_are_rejected_before_creating_jobs(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            TestClient(create_app("image-test", Path(directory) / "app.db")) as client,
        ):
            for change in [
                {"mode": "edit"},
                {"mode": "inpaint", "reference_ids": ["missing"]},
                {"mode": "edit", "reference_ids": ["missing"]},
                {"mode": "edit", "reference_ids": ["one", "one"]},
                {"mode": "generate", "reference_ids": ["one"]},
                {"mode": "generate", "strength": 0.5},
                {"mode": "edit", "reference_ids": ["one"], "strength": 0},
            ]:
                response = client.post(
                    "/internal/v1/image-jobs",
                    json=dict(PARAMETERS, **change),
                    headers=HEADERS,
                )
                self.assertIn(response.status_code, [400, 404, 422])
            self.assertEqual(
                client.get("/internal/v1/image-jobs", headers=HEADERS).json(), []
            )


if __name__ == "__main__":
    unittest.main()
