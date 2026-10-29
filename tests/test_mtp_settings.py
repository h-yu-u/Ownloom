import asyncio
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.coding_model_identity import coding_model_identity
from mlx_studio_runtime.adapters.mtp_metadata import validate_mtp_files
from mlx_studio_runtime.application.model_acceleration import ModelAcceleration
from mlx_studio_runtime.application.model_catalog import ModelCatalog
from mlx_studio_runtime.application.model_run_references import ModelRunReferences
from mlx_studio_runtime.domain.models import fake_text_manifest, manifest_from_dict
from mlx_studio_runtime.domain.mtp import MtpSettings, restore_mtp
from mlx_studio_runtime.entrypoints.http.app import create_app


def make_models(root):
    root = root.resolve()
    target, draft = root / "target", root / "draft"
    config = {"hidden_size": 16, "vocab_size": 32}
    for path, kind in ((target, "qwen3_5"), (draft, "qwen3_5_mtp")):
        path.mkdir()
        (path / "config.json").write_text(
            json.dumps({"model_type": kind, "text_config": config, "vision_config": {}})
        )
        (path / "model.safetensors").write_bytes(b"isolated-placeholder")
    return target, draft


class MtpMetadataTests(unittest.TestCase):
    def test_old_manifest_is_off_and_invalid_settings_fail_closed(self):
        manifest = fake_text_manifest().to_dict()
        manifest.pop("mtp")
        self.assertIsNone(manifest_from_dict(manifest).mtp)
        for settings in (
            {},
            {"draftPath": ""},
            {"draftPath": "/draft", "blockSize": 5},
        ):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                restore_mtp(settings)

    def test_local_metadata_rejects_remote_missing_wrong_type_and_size(self):
        with tempfile.TemporaryDirectory() as directory:
            target, draft = make_models(Path(directory))
            settings = MtpSettings(str(draft), 3)
            self.assertEqual(
                validate_mtp_files("mlx-vlm", str(target), settings), settings
            )
            for engine, path in (("mlx-lm", str(draft)), ("mlx-vlm", "org/repo")):
                with self.assertRaises(ValueError):
                    validate_mtp_files(engine, str(target), MtpSettings(path))
            config = json.loads((draft / "config.json").read_text())
            config["text_config"]["vocab_size"] = 33
            (draft / "config.json").write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, "MTP_TARGET_MISMATCH"):
                validate_mtp_files("mlx-vlm", str(target), settings)
            config["text_config"]["vocab_size"] = 32
            (draft / "config.json").write_text(json.dumps(config))
            (draft / "model.safetensors").unlink()
            with self.assertRaisesRegex(ValueError, "MTP_WEIGHTS_MISSING"):
                validate_mtp_files("mlx-vlm", str(target), settings)

    def test_tool_probe_identity_includes_mtp_settings_and_weight_version(self):
        with tempfile.TemporaryDirectory() as directory:
            target, draft = make_models(Path(directory))
            model = replace(
                fake_text_manifest(), engine="mlx-vlm", local_path=str(target)
            )
            off = coding_model_identity(model)
            enabled = replace(model, mtp=MtpSettings(str(draft)))
            first = coding_model_identity(enabled)
            block4 = coding_model_identity(
                replace(enabled, mtp=MtpSettings(str(draft), 4))
            )
            (draft / "model.safetensors").write_bytes(b"replacement-weights")
            self.assertEqual(
                len({off, first, block4, coding_model_identity(enabled)}), 4
            )


class MtpApiTests(unittest.TestCase):
    def test_authenticated_configuration_survives_restart_and_reimport(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target, draft = make_models(root)
            headers = {"Authorization": "Bearer test"}
            settings = {"draftPath": str(draft), "blockSize": 4}
            database = root / "app.db"
            with TestClient(create_app("test", database)) as client:
                model = client.post(
                    "/internal/v1/models/import",
                    json={"path": str(target)},
                    headers=headers,
                ).json()
                url = f"/internal/v1/models/{model['id']}/mtp"
                self.assertEqual(client.post(url, json=settings).status_code, 401)
                result = client.post(url, json=settings, headers=headers)
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["mtp"], settings)
                for body in ({"draftPath": "org/repo"}, {**settings, "blockSize": 16}):
                    self.assertIn(
                        client.post(url, json=body, headers=headers).status_code,
                        (400, 422),
                    )
                rescanned = client.post(
                    "/internal/v1/models/import",
                    json={"path": str(target)},
                    headers=headers,
                ).json()
                self.assertEqual(rescanned["mtp"], settings)
            with TestClient(create_app("test", database)) as client:
                models = client.get("/internal/v1/models", headers=headers).json()
                self.assertEqual(models[0]["mtp"], settings)
                disabled = client.post(url, json={"draftPath": None}, headers=headers)
                self.assertEqual(disabled.status_code, 200)
                self.assertIsNone(disabled.json()["mtp"])


class MtpLeaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_waits_for_lease_and_unloads_before_persisting(self):
        model = fake_text_manifest()
        catalog = Mock(models={model.id: model}, events=AsyncMock())
        scheduler = Mock(lock=asyncio.Lock())
        runtime = Mock(active_model_id=model.id, stop=AsyncMock())
        settings = MtpSettings("/draft")
        service = ModelAcceleration(
            catalog,
            scheduler,
            runtime,
            lambda _, value: value,
            references=ModelRunReferences(),
        )
        await scheduler.lock.acquire()
        saving = asyncio.create_task(service.configure(model.id, settings))
        await asyncio.sleep(0)
        runtime.stop.assert_not_called()
        catalog.repository.upsert.assert_not_called()
        scheduler.lock.release()
        await saving
        runtime.stop.assert_awaited_once()
        self.assertEqual(catalog.models[model.id].mtp, settings)
        runtime.stop.side_effect = RuntimeError("release failed")
        with self.assertRaises(RuntimeError):
            await service.configure(model.id, None)
        self.assertEqual(catalog.models[model.id].mtp, settings)
        catalog.repository.upsert.assert_called_once()

    async def test_referenced_draft_directory_blocks_managed_file_deletion(self):
        repository = Mock()
        repository.list.return_value = []
        catalog = ModelCatalog(repository, AsyncMock(), Mock(), Mock())
        target = replace(fake_text_manifest(), id="target", local_path="/managed/model")
        other = replace(
            target,
            id="other",
            local_path="/other",
            mtp=MtpSettings("/managed/model/mtp"),
        )
        catalog.models = {target.id: target, other.id: other}
        self.assertTrue(catalog.shared_path(target))
        catalog.models[other.id] = replace(other, mtp=None)
        self.assertFalse(catalog.shared_path(target))
