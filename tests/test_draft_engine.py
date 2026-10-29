import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from mlx_studio_runtime.adapters.text_engines.drafts import DraftAcceleration
from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.adapters.text_engines.structured import _generate_native
from mlx_studio_runtime.domain.drafts import DraftLoadError, DraftSettings


class DraftEngineTests(unittest.TestCase):
    def test_partial_load_failure_releases_both_heads_without_fallback(self):
        manager = DraftAcceleration(Mock())
        manifest = {"draft": DraftSettings(True, "auto", "/mtp", "/dflash").to_dict()}
        with (
            patch.object(
                manager, "_load_dflash", side_effect=RuntimeError("private path")
            ),
            self.assertRaisesRegex(DraftLoadError, "^DRAFT_LOAD_FAILED$"),
        ):
            manager.load(manifest, object())
        manager.mtp.clear.assert_called_once()
        self.assertIsNone(manager.dflash)

    def test_sampling_preserves_target_options_and_constructor_failure_restores_hooks(
        self,
    ):
        session = EngineSession(emit=lambda *_: None)
        session.engine, session.model = "mlx-vlm", object()
        session.drafts.settings = DraftSettings(True, "auto", "/mtp", "/dflash")
        session.drafts.dflash = Mock()
        session.mtp.model = Mock()
        session.processor = SimpleNamespace(
            tokenizer=SimpleNamespace(encode=lambda _: [1])
        )
        session._vlm_prompt = Mock(return_value="synthetic")
        native = ModuleType("mlx_vlm")
        native.stream_generate = Mock(side_effect=RuntimeError("construction"))
        with (
            patch.dict(sys.modules, {"mlx_vlm": native}),
            self.assertRaisesRegex(RuntimeError, "construction"),
        ):
            _generate_native(
                session,
                "synthetic",
                {"job_id": "j", "max_tokens": 16, "temperature": 0.7},
            )
        options = native.stream_generate.call_args.kwargs
        self.assertEqual(options["temperature"], 0.7)
        self.assertEqual(options["draft_kind"], "dflash")
        self.assertIsInstance(options["seed"], int)
        session.drafts.dflash.begin_request.assert_called_once_with(session.model)
        session.drafts.dflash.end_request.assert_called_once()
        session.mtp.model.reset.assert_not_called()

    def test_dflash_cancellation_closes_native_and_drops_incomplete_state(self):
        session = EngineSession(emit=lambda *_: None)
        session.engine, session.model = "mlx-vlm", object()
        session.processor = SimpleNamespace(
            tokenizer=SimpleNamespace(encode=lambda _: [1])
        )
        session._vlm_prompt = Mock(return_value="synthetic")
        session.drafts.settings = DraftSettings(True, "dflash2", dflash_path="/dflash")
        session.drafts.dflash = Mock()
        session.prefix_cache = Mock(options={})
        closed = []

        def stream(**kwargs):
            self.assertNotIn("apc_manager", kwargs)
            try:
                yield SimpleNamespace(text="first")
                yield SimpleNamespace(text="second")
            finally:
                closed.append(True)

        native = ModuleType("mlx_vlm")
        native.stream_generate = stream
        with patch.dict(sys.modules, {"mlx_vlm": native}):
            chunks = session._vlm_chunks("synthetic", 16, 0, [])
            self.assertEqual(next(chunks), "first")
            chunks.close()
        self.assertEqual(closed, [True])
        session.prefix_cache.clear.assert_called_once()
        session.drafts.dflash.end_request.assert_called_once()
        session.unload()
        self.assertIsNone(session.drafts.dflash)
