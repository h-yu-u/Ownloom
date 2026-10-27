import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.adapters.secret_store import KeychainSecrets
from mlx_studio_runtime.entrypoints.http.app import create_app


class BrandCompatibilityTests(unittest.TestCase):
    def test_ownloom_reads_existing_standalone_history_from_the_legacy_location(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            path = home / "Library/Application Support/MLX Studio/data/app.db"
            store = SQLiteRepositories(path)
            store.conversations.save({"id": "existing", "title": "原有对话"})
            store.conversations.save_message(
                {
                    "id": "message",
                    "conversationId": "existing",
                    "role": "user",
                    "content": "原有内容",
                }
            )
            store.close()
            with (
                patch.dict(os.environ, {"MLX_STUDIO_DATA_DIR": ""}),
                patch(
                    "mlx_studio_runtime.entrypoints.http.app.Path.home",
                    return_value=home,
                ),
            ):
                app = create_app("test", external_api_enabled=False)
                self.assertEqual(app.title, "Ownloom Runtime")
                with TestClient(
                    app, headers={"Authorization": "Bearer test"}
                ) as client:
                    result = client.get("/internal/v1/conversations/existing")
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(
                        result.json()["messages"][0]["content"], "原有内容"
                    )
                    self.assertEqual(result.json()["title"], "原有对话")
            self.assertFalse((home / "Library/Application Support/Ownloom").exists())

    def test_existing_keychain_references_resolve_without_creating_new_credentials(
        self,
    ) -> None:
        for purpose, namespace in (
            ("web-search", "MLX Studio Web Search"),
            ("mcp", "MLX Studio MCP Connections"),
        ):
            with (
                self.subTest(purpose=purpose),
                patch(
                    "mlx_studio_runtime.adapters.secret_store.sys.platform", "darwin"
                ),
                patch("mlx_studio_runtime.adapters.secret_store.Keyring") as factory,
            ):
                factory.return_value.get_password.side_effect = (
                    lambda service, reference, expected=namespace: (
                        "existing-value"
                        if service == expected and reference == "saved-reference"
                        else None
                    )
                )
                secrets = KeychainSecrets(purpose)
                self.assertEqual(secrets.resolve("saved-reference"), "existing-value")
                factory.return_value.set_password.assert_not_called()
