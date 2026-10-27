import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "runtime" / "src"))

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.huggingface_catalog import search_mlx_models
from mlx_studio_runtime.domain.errors import RuntimeFault
from mlx_studio_runtime.domain.model_catalog import HubModel, read_hub_models
from mlx_studio_runtime.entrypoints.http.app import create_app


class HubCatalogMetadataTests(unittest.TestCase):
    def test_accepts_only_public_mlx_metadata_without_name_guessing(self) -> None:
        items = [
            {"id": "community/good", "tags": ["mlx"], "downloads": 42, "likes": 3},
            {"id": "community/library", "library_name": "mlx"},
            {"id": "community/fake-MLX", "tags": ["pytorch"]},
            {"id": "community/gated", "tags": ["mlx"], "gated": "auto"},
            {"id": "community/private", "tags": ["mlx"], "private": True},
            {"id": "community/good", "tags": ["mlx"]},
            {"id": "invalid", "tags": ["mlx"]},
        ]
        models = read_hub_models(items)
        self.assertEqual(
            [model.repo_id for model in models], ["community/good", "community/library"]
        )
        self.assertEqual(models[0].downloads, 42)
        self.assertIsNone(models[1].task)

    def test_rejects_invalid_payload_and_normalizes_optional_fields(self) -> None:
        with self.assertRaises(ValueError):
            read_hub_models({"error": "unavailable"})
        model = read_hub_models(
            [
                {
                    "id": "community/model",
                    "tags": ["mlx"],
                    "downloads": -1,
                    "likes": True,
                },
            ]
        )[0]
        self.assertEqual((model.downloads, model.likes), (0, 0))


class HubCatalogAdapterTests(unittest.TestCase):
    @patch("mlx_studio_runtime.adapters.huggingface_catalog.urlopen")
    def test_search_uses_mlx_filter_encoded_query_and_bounded_timeout(
        self, open_url
    ) -> None:
        open_url.return_value = io.BytesIO(
            json.dumps(
                [
                    {"id": "community/Qwen", "tags": ["mlx"]},
                ]
            ).encode()
        )
        self.assertEqual(len(search_mlx_models(" Qwen & 4-bit ", 20)), 1)
        request = open_url.call_args.args[0]
        query = parse_qs(urlparse(request.full_url).query)
        self.assertEqual(query["filter"], ["mlx"])
        self.assertEqual(query["search"], ["Qwen & 4-bit"])
        self.assertEqual(query["sort"], ["downloads"])
        self.assertEqual(query["limit"], ["20"])
        self.assertEqual(open_url.call_args.kwargs["timeout"], 12)
        self.assertIsNone(request.get_header("Authorization"))

    @patch("mlx_studio_runtime.adapters.huggingface_catalog.urlopen")
    def test_network_and_malformed_responses_map_to_retryable_errors(
        self, open_url
    ) -> None:
        for failure in [URLError("offline"), ValueError("malformed")]:
            open_url.side_effect = failure
            with self.assertRaises(RuntimeFault) as caught:
                search_mlx_models("Qwen", 10)
            self.assertEqual(caught.exception.info.code, "HF_CATALOG_NOT_AVAILABLE")
            self.assertTrue(caught.exception.info.retryable)

    @patch("mlx_studio_runtime.adapters.huggingface_catalog.urlopen")
    def test_rejects_oversized_responses(self, open_url) -> None:
        open_url.return_value = io.BytesIO(b" " * (2 * 1024 * 1024 + 1))
        with self.assertRaises(RuntimeFault):
            search_mlx_models("", 10)


class HubCatalogApiTests(unittest.TestCase):
    def test_catalog_route_auth_validation_and_error_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_app("catalog-test", Path(directory) / "app.db")
            with (
                TestClient(app) as client,
                patch(
                    "mlx_studio_runtime.entrypoints.http.model_catalog.search_mlx_models",
                    return_value=(
                        HubModel("community/model", 100, 5, "text-generation", None),
                    ),
                ) as search,
            ):
                url = "/internal/v1/models/catalog"
                headers = {"Authorization": "Bearer catalog-test"}
                self.assertEqual(client.get(url).status_code, 401)
                result = client.get(
                    url, params={"query": "Qwen", "limit": 10}, headers=headers
                )
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()[0]["repo_id"], "community/model")
                search.assert_called_once_with("Qwen", 10)
                self.assertEqual(
                    client.get(url, params={"limit": 51}, headers=headers).status_code,
                    422,
                )
                self.assertEqual(
                    client.get(
                        url, params={"query": "x" * 101}, headers=headers
                    ).status_code,
                    422,
                )
                search.side_effect = TimeoutError("upstream timeout")
                failed = client.get(url, headers=headers)
                self.assertEqual(failed.status_code, 503)
                self.assertEqual(
                    failed.json()["error"]["code"], "HF_CATALOG_NOT_AVAILABLE"
                )

    def test_selected_repository_download_is_registered(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model_dir = (
                root
                / "models"
                / "community--selected-mlx"
                / hashlib.sha256(b"resolved").hexdigest()[:16]
            )
            model_dir.mkdir(parents=True)
            (model_dir / "config.json").write_text(json.dumps({"model_type": "qwen2"}))
            (model_dir / "model.safetensors").write_bytes(b"test-placeholder")
            app = create_app("download-test", root / "app.db")
            headers = {"Authorization": "Bearer download-test"}
            with (
                TestClient(app) as client,
                patch.object(
                    app.state.service.downloads,
                    "download",
                    new_callable=AsyncMock,
                    return_value=(model_dir, "resolved"),
                ) as download,
                patch(
                    "huggingface_hub.HfApi.model_info",
                    return_value=SimpleNamespace(sha="resolved"),
                ),
                patch.dict(
                    "os.environ", {"MLX_STUDIO_MODELS_DIR": str(root / "models")}
                ),
            ):
                result = client.post(
                    "/internal/v1/models/pull",
                    json={"repo_id": "community/selected-mlx"},
                    headers=headers,
                )
                self.assertEqual(result.status_code, 200)
                self.assertEqual(download.call_args.args[0], "community/selected-mlx")
                models = client.get("/internal/v1/models", headers=headers).json()
                model = next(
                    item for item in models if item["id"] == result.json()["modelId"]
                )
                self.assertEqual(model["displayName"], "community/selected-mlx")
                self.assertEqual(model["source"], "huggingface")
                self.assertEqual(model["revision"], "resolved")
                self.assertTrue(model["managedInstallation"])
