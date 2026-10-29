import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from mlx_studio_runtime.adapters.text_engines.mtp import MtpDraft
from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.adapters.text_engines.structured import _generate_native
from mlx_studio_runtime.domain.mtp import MtpLoadError, MtpSettings


class MtpEngineTests(unittest.TestCase):
    def test_nonzero_temperature_uses_seeded_sampling_without_changing_greedy_or_images(
        self,
    ):
        head = MtpDraft()
        head.model = Mock()
        with patch(
            "mlx_studio_runtime.adapters.text_engines.mtp.secrets.randbits",
            return_value=123,
        ) as seed:
            self.assertNotIn("seed", head.options(temperature=0))
            self.assertEqual(head.options(temperature=0.7)["seed"], 123)
            self.assertEqual(head.options(temperature=0.7, has_images=True), {})
            seed.assert_called_once_with(32)

    def test_loader_binds_validated_local_head_without_loading_draft_tokenizer(self):
        mlx, core = ModuleType("mlx"), ModuleType("mlx.core")
        mlx.core = core
        core.eval, core.synchronize = Mock(), Mock()
        spec = ModuleType("mlx_vlm.speculative")
        drafters = ModuleType("mlx_vlm.speculative.drafters")
        draft = Mock(bind=Mock(), parameters=Mock(return_value={}), reset=Mock())
        target = object()
        spec.load_drafter = Mock(return_value=(draft, "mtp"))
        drafters.validate_drafter_compatibility = Mock()
        manifest = {
            "engine": "mlx-vlm",
            "localPath": "/target",
            "mtp": MtpSettings("/draft").to_dict(),
        }
        head = MtpDraft()
        with (
            patch.dict(
                sys.modules,
                {
                    "mlx": mlx,
                    "mlx.core": core,
                    "mlx_vlm.speculative": spec,
                    "mlx_vlm.speculative.drafters": drafters,
                },
            ),
            patch(
                "mlx_studio_runtime.adapters.text_engines.mtp.validate_mtp_files",
                return_value=MtpSettings("/draft"),
            ),
        ):
            head.load(manifest, target)
            spec.load_drafter.assert_called_once_with(
                "/draft", kind="mtp", trust_remote_code=False
            )
            draft.bind.assert_called_once_with(target)
            core.synchronize.assert_called_once()
            self.assertIs(head.options()["draft_model"], draft)
            head.clear()
            self.assertEqual(head.options(), {})
            spec.load_drafter.return_value = draft, "dflash"
            with self.assertRaisesRegex(MtpLoadError, "MTP_LOAD_FAILED"):
                head.load(manifest, target)
            self.assertIsNone(head.model)

    def session(self):
        session = EngineSession(emit=lambda *_: None)
        session.engine, session.model_id = "mlx-vlm", "model"
        session.model = object()
        session.processor = SimpleNamespace(
            tokenizer=SimpleNamespace(encode=lambda _: [1])
        )
        session.mtp.model = Mock()
        session._vlm_prompt = Mock(return_value="prompt")
        return session

    def test_chat_uses_target_processor_and_cache_then_cleans_cancelled_draft(self):
        session = self.session()
        apc = object()
        session.prefix_cache.options = {"apc_manager": apc}
        calls, closed = [], []

        def stream(**kwargs):
            calls.append(kwargs)
            try:
                yield SimpleNamespace(text="first")
                yield SimpleNamespace(text="second")
            finally:
                closed.append(True)

        library = ModuleType("mlx_vlm")
        library.stream_generate = stream
        with patch.dict(sys.modules, {"mlx_vlm": library}):
            chunks = session._vlm_chunks("hello", 16, 0.7, [])
            self.assertEqual(next(chunks), "first")
            chunks.close()
            session.mtp.model.reset.assert_called_once_with(session.model)
            self.assertEqual(
                list(session._vlm_chunks("again", 16, 0, [])), ["first", "second"]
            )
            list(session._vlm_chunks("image", 16, 0, ["synthetic.png"]))
        self.assertIs(calls[0]["processor"], session.processor)
        self.assertIs(calls[0]["apc_manager"], apc)
        self.assertEqual(calls[0]["draft_block_size"], 3)
        self.assertEqual(calls[0]["temperature"], 0.7)
        self.assertNotIn("draft_model", calls[2])
        self.assertEqual(len(closed), 3)
        session.unload()
        self.assertIsNone(session.mtp.model)

    def test_structured_cancellation_and_failure_close_the_native_generator(self):
        for mode in ("cancel", "error", "complete"):
            session = self.session()
            calls, closed = [], []

            def stream(
                mode=mode, session=session, calls=calls, closed=closed, **kwargs
            ):
                calls.append(kwargs)
                try:
                    yield SimpleNamespace(text="first", generation_tokens=1)
                    if mode == "cancel":
                        session.cancel.set()
                    elif mode == "error":
                        raise RuntimeError("inference failed")
                    yield SimpleNamespace(text="second", generation_tokens=2)
                finally:
                    closed.append(True)

            library = ModuleType("mlx_vlm")
            library.stream_generate = stream
            with patch.dict(sys.modules, {"mlx_vlm": library}):
                payload = {"job_id": "job", "max_tokens": 16, "temperature": 0}
                if mode == "error":
                    with self.assertRaises(RuntimeError):
                        _generate_native(session, "prompt", payload)
                else:
                    _generate_native(session, "prompt", payload)
            self.assertEqual(calls[0]["draft_kind"], "mtp")
            self.assertEqual(closed, [True])
            session.mtp.model.reset.assert_called_once_with(session.model)
