import asyncio
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from fastapi.testclient import TestClient
from mlx_studio_runtime.adapters.draft_metadata import validate_dflash_files
from mlx_studio_runtime.application.model_acceleration import ModelAcceleration
from mlx_studio_runtime.application.model_run_references import ModelRunReferences
from mlx_studio_runtime.domain.drafts import (
    DraftSettings,
    effective_draft,
    restore_draft,
)
from mlx_studio_runtime.domain.models import fake_text_manifest, manifest_from_dict
from mlx_studio_runtime.domain.mtp import MtpSettings
from mlx_studio_runtime.entrypoints.http.app import create_app
from test_mtp_settings import make_models


def dflash_config():
    return {
        "architectures": ["DFlash2DraftModel"],
        "hidden_size": 16,
        "vocab_size": 32,
        "num_target_layers": 4,
        "num_hidden_layers": 2,
        "num_attention_heads": 2,
        "num_key_value_heads": 1,
        "head_dim": 8,
        "intermediate_size": 32,
        "max_position_embeddings": 1024,
        "rms_norm_eps": 1e-6,
        "rope_parameters": {"rope_type": "default", "rope_theta": 10000},
        "layer_types": ["sliding_attention"] * 2,
        "sliding_window": 32,
        "is_causal": False,
        "dflash_config": {
            "target_layer_ids": [0, 3],
            "block_size": 8,
            "mask_token_id": 31,
            "conv_kernel_size": 2,
            "conv_group_size": 8,
            "selector_rank": 8,
            "selector_top_k": 4,
        },
    }


class DraftSettingsTests(unittest.TestCase):
    def test_switch_routing_and_legacy_restore(self):
        legacy = MtpSettings("/mtp", 4)
        self.assertEqual(effective_draft(None, legacy).select(coding=True), "mtp")
        settings = DraftSettings(True, "auto", "/mtp", "/dflash")
        self.assertEqual(settings.select(), "mtp")
        self.assertEqual(settings.select(coding=True), "dflash2")
        self.assertIsNone(settings.select(coding=True, has_images=True))
        self.assertIsNone(
            effective_draft(replace(settings, enabled=False), legacy).select()
        )
        self.assertEqual(restore_draft(settings.to_dict()), settings)
        self.assertEqual(
            manifest_from_dict(
                replace(fake_text_manifest(), draft=settings).to_dict()
            ).draft,
            settings,
        )
        for value in (
            {"enabled": 1},
            {"enabled": True},
            {"mode": "invalid"},
            {"dflashBlockSize": True},
            {"mtpPath": ""},
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                restore_draft(value)

    def test_dflash_metadata_rejects_incompatible_or_unbounded_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            target, draft = make_models(Path(directory))
            target_config = json.loads((target / "config.json").read_text())
            target_config["text_config"]["num_hidden_layers"] = 4
            (target / "config.json").write_text(json.dumps(target_config))
            config = dflash_config()
            (draft / "config.json").write_text(json.dumps(config))
            self.assertEqual(validate_dflash_files(str(target), str(draft)), str(draft))
            for patch in (
                {"architectures": ["DFlashDraftModel"]},
                {"vocab_size": 33},
                {"sliding_window": 1000000},
                {"intermediate_size": -1},
            ):
                (draft / "config.json").write_text(json.dumps({**config, **patch}))
                with self.assertRaises(ValueError):
                    validate_dflash_files(str(target), str(draft))

    def test_authenticated_switch_persists_and_can_disable_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target, mtp = make_models(root)
            headers = {"Authorization": "Bearer synthetic"}
            settings = DraftSettings(True, "mtp", str(mtp)).to_dict()
            with TestClient(create_app("synthetic", root / "app.db")) as client:
                model = client.post(
                    "/internal/v1/models/import",
                    json={"path": str(target)},
                    headers=headers,
                ).json()
                url = f"/internal/v1/models/{model['id']}/draft"
                self.assertEqual(client.post(url, json=settings).status_code, 401)
                result = client.post(url, json=settings, headers=headers)
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["draft"], settings)
                self.assertEqual(
                    client.post(
                        url, json={"enabled": True}, headers=headers
                    ).status_code,
                    422,
                )
                (mtp / "model.safetensors").unlink()
                settings["enabled"] = False
                self.assertEqual(
                    client.post(url, json=settings, headers=headers).status_code, 200
                )
                imported = client.post(
                    "/internal/v1/models/import",
                    json={"path": str(target)},
                    headers=headers,
                ).json()
                self.assertEqual(imported["draft"], settings)
            with TestClient(create_app("synthetic", root / "app.db")) as client:
                self.assertEqual(
                    client.get("/internal/v1/models", headers=headers).json()[0][
                        "draft"
                    ],
                    settings,
                )


class DraftLeaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_settings_wait_and_failed_release_preserves_old_switch(self):
        model = fake_text_manifest()
        catalog = Mock(models={model.id: model}, events=AsyncMock())
        scheduler = Mock(lock=asyncio.Lock())
        runtime = Mock(active_model_id=model.id, stop=AsyncMock())
        service = ModelAcceleration(
            catalog,
            scheduler,
            runtime,
            Mock(),
            lambda _, value: value,
            references=ModelRunReferences(),
        )
        settings = DraftSettings(True, "auto", "/mtp", "/dflash")
        await scheduler.lock.acquire()
        pending = asyncio.create_task(service.configure_draft(model.id, settings))
        await asyncio.sleep(0)
        runtime.stop.assert_not_called()
        scheduler.lock.release()
        await pending
        runtime.stop.assert_awaited_once()
        runtime.stop.side_effect = RuntimeError("release failed")
        with self.assertRaises(RuntimeError):
            await service.configure_draft(model.id, replace(settings, enabled=False))
        self.assertTrue(catalog.models[model.id].draft.enabled)
        catalog.repository.upsert.assert_called_once()
