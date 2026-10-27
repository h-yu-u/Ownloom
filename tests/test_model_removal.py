import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from mlx_studio_runtime.domain.jobs import Job, JobState
from mlx_studio_runtime.domain.models import fake_text_manifest
from mlx_studio_runtime.entrypoints.http.app import create_app


class ModelRemovalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.path = self.root / "models" / "download"
        self.path.mkdir(parents=True)
        (self.path / "weights").write_bytes(b"placeholder")
        self.app = create_app("test", self.root / "app.db")
        self.service = self.app.state.service
        self.model = replace(
            fake_text_manifest(),
            id="removable",
            source="huggingface",
            managed_installation=True,
            local_path=str(self.path),
        )
        self.service.catalog.models[self.model.id] = self.model
        self.service.store.models.upsert(self.model.to_dict(), "available")
        self.environment = patch.dict(
            "os.environ", {"MLX_STUDIO_MODELS_DIR": str(self.root / "models")}
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.headers = {"Authorization": "Bearer test"}

    def delete(self, action="files", confirm=True):
        return self.client.delete(
            f"/internal/v1/models/removable/{action}",
            params={"confirm": confirm},
            headers=self.headers,
        )

    def test_referenced_models_cannot_be_deleted_or_unregistered(self):
        for kind in ["chat", "image"]:
            for state in [
                JobState.QUEUED,
                JobState.PREPARING,
                JobState.RUNNING,
                JobState.CANCELLING,
            ]:
                for action in ["files", "registration"]:
                    with self.subTest(kind=kind, state=state, action=action):
                        self.service.lifecycle._items["reference"] = Job(
                            "reference", kind, state, self.model.id
                        )
                        response = self.delete(action)
                        self.assertEqual(response.status_code, 409)
                        self.assertEqual(
                            response.json()["error"]["code"], "MODEL_IN_USE"
                        )
                        self.assertTrue(self.path.is_dir())
                        self.assertIn(self.model.id, self.service.catalog.models)

    def test_loaded_model_is_stopped_before_files_are_deleted(self):
        async def stop():
            self.assertTrue((self.path / "weights").is_file())

        worker = SimpleNamespace(stop=AsyncMock(side_effect=stop))
        self.service.inference.worker = worker
        self.service.inference.active_model_id = self.model.id
        self.assertEqual(self.delete().status_code, 200)
        worker.stop.assert_awaited_once()
        self.assertFalse(self.path.exists())
        self.assertNotIn(self.model.id, self.service.catalog.models)

    def test_unload_failure_preserves_files_and_registration(self):
        self.service.inference.worker = SimpleNamespace(
            stop=AsyncMock(side_effect=OSError("stop failed"))
        )
        self.service.inference.active_model_id = self.model.id
        response = self.delete()
        self.service.inference.worker = None  # Allow teardown after injected failure.
        self.assertEqual(response.status_code, 503)
        self.assertTrue(self.path.is_dir())
        self.assertIn(self.model.id, self.service.catalog.models)

    def test_imported_directory_inside_managed_root_is_not_owned(self):
        self.service.catalog.models[self.model.id] = replace(self.model, source="local")
        self.assertEqual(self.delete().status_code, 400)
        self.assertTrue(self.path.is_dir())
        self.assertEqual(self.delete("registration").status_code, 200)
        self.assertTrue(self.path.is_dir())

    def test_confirmation_and_managed_root_boundaries(self):
        self.assertEqual(self.delete(confirm=False).status_code, 400)
        for path in [self.root, self.root / "models"]:
            self.service.catalog.models[self.model.id] = replace(
                self.model, local_path=str(path)
            )
            self.assertEqual(self.delete().status_code, 400)
            self.assertTrue(path.is_dir())

    def test_file_failure_preserves_registration(self):
        with patch("shutil.rmtree", side_effect=OSError("disk error")):
            response = self.delete()
        self.assertEqual(response.status_code, 503)
        self.assertIn(self.model.id, self.service.catalog.models)
        self.assertTrue(self.service.store.models.list())
