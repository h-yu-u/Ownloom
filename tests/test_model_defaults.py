"""Normal startup has no demo models; legacy cleanup preserves real models and history."""

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.models import fake_text_manifest
from mlx_studio_runtime.entrypoints.http.app import create_app
from runtime_fixtures import seed_fake_models


class ModelDefaultsTests(unittest.TestCase):
    def test_fresh_start_and_restart_do_not_register_fake_models(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "app.db"
            for _ in range(2):
                with TestClient(create_app("test", database)) as client:
                    response = client.get(
                        "/internal/v1/models", headers={"Authorization": "Bearer test"}
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), [])
                    self.assertEqual(client.app.state.service.catalog.models, {})

    def test_upgrade_removes_builtin_demos_and_retains_real_models_history_and_files(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "app.db"
            store = SQLiteRepositories(database)
            seed_fake_models(store)
            real = replace(
                fake_text_manifest(),
                id="real",
                source="local",
                engine="mlx-lm",
                local_path=str(root / "real-weights"),
            )
            (root / "real-weights").mkdir()
            (root / "real-weights/model.safetensors").write_bytes(b"preserve")
            store.models.upsert(real.to_dict())
            store.conversations.save(
                {"id": "old", "title": "历史", "modelId": "builtin-fake-text"}
            )
            store.conversations.save_message(
                {
                    "id": "message",
                    "conversationId": "old",
                    "role": "assistant",
                    "content": "保留历史",
                }
            )
            with store.database.transaction() as connection:
                connection.execute("DELETE FROM schema_migrations WHERE version=6")
            store.close()
            for _ in range(2):
                with TestClient(create_app("test", database)) as client:
                    service = client.app.state.service
                    models = service.catalog.list_models()
                    self.assertEqual([model["id"] for model in models], ["real"])
                    self.assertEqual(set(service.catalog.models), {"real"})
                    self.assertEqual(
                        service.queries.conversation("old")["messages"][0]["content"],
                        "保留历史",
                    )
                    self.assertEqual(
                        (root / "real-weights/model.safetensors").read_bytes(),
                        b"preserve",
                    )
