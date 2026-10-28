import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.adapters.worker_runtime.context import WorkerContext
from mlx_studio_runtime.adapters.worker_runtime.drivers import TextDriver


class PrefixCacheSessionTests(unittest.TestCase):
    def test_structured_inference_releases_chat_cache_before_execution(self):
        driver = TextDriver(WorkerContext(lambda *_: None))
        driver.session.prefix_cache = Mock()
        with patch(
            "mlx_studio_runtime.adapters.worker_runtime.drivers.generate_structured"
        ) as infer:
            infer.side_effect = lambda *_: (
                driver.session.prefix_cache.clear.assert_called_once_with()
            )
            driver.infer({"job_id": "coding"})
        infer.assert_called_once_with(driver.session, {"job_id": "coding"})

    def test_failure_and_shutdown_discard_the_snapshot_and_close_stream(self):
        for reason in ("failure", "shutdown"):
            with self.subTest(reason=reason):
                events, closed = [], []
                session = EngineSession(
                    emit=lambda kind, _, events=events: events.append(kind)
                )
                session.model_id = "model"
                session.prefix_cache = Mock()

                def chunks(*_args, reason=reason, session=session, closed=closed):
                    try:
                        yield "first"
                        if reason == "failure":
                            raise RuntimeError("inference failed")
                        session.shutdown.set()
                        yield "late"
                    finally:
                        closed.append(True)

                session._chunks = chunks
                session.generate({"job_id": "job", "conversation_id": "A"})
                session.prefix_cache.finish.assert_called_once_with(False)
                expected = "failed" if reason == "failure" else "cancelled"
                self.assertEqual(events[-1], f"generation.{expected}")
                self.assertEqual(closed, [True])

    def test_unload_releases_snapshot_before_model_references(self):
        session = EngineSession()
        model = object()
        session.model = model
        session.prefix_cache = Mock()
        session.prefix_cache.clear.side_effect = lambda: self.assertIs(
            session.model, model
        )
        session.unload()
        session.prefix_cache.clear.assert_called_once_with()
        self.assertIsNone(session.model)

    def test_time_boundary_excludes_volatile_suffix_without_changing_messages(self):
        session = EngineSession()
        session.prefix_cache = Mock(options={"apc_manager": object()}, suffix=" TIME")
        session.processor = SimpleNamespace(tokenizer=SimpleNamespace(encode=list))
        templates = ModuleType("mlx_vlm.prompt_utils")
        templates.apply_chat_template = lambda _p, _c, msgs, **_: (
            msgs[-1]["content"] + " END"
        )
        messages = [{"role": "user", "content": "stable TIME"}]
        with patch.dict(sys.modules, {"mlx_vlm.prompt_utils": templates}):
            session._cache_boundary(messages, "stable TIME END")
        session.prefix_cache.guard_suffix.assert_called_once_with(
            list("stable TIME END"), list("stable END")
        )
        self.assertEqual(messages[-1]["content"], "stable TIME")
        session.prefix_cache.clear.assert_not_called()

    def test_chat_reuses_cache_and_clears_it_after_cancellation(self):
        calls, closed = [], []
        library = ModuleType("mlx_vlm")
        library.__path__ = []
        templates = ModuleType("mlx_vlm.prompt_utils")
        templates.apply_chat_template = lambda *_args, **_kwargs: "formatted"
        apc = ModuleType("mlx_vlm.apc")

        class Manager:
            exact_cache_guard_tokens = 16

            def __init__(self, **_kwargs):
                self.clear_count = 0

            def clear(self):
                self.clear_count += 1

            def close(self):
                pass

        apc.APCManager = Manager
        apc.model_apc_mode = lambda _model: "exact"
        session = EngineSession(emit=lambda *_: None)
        session.model_id = "model"
        session.engine = "mlx-vlm"
        session.model = SimpleNamespace(language_model=object())
        session.processor = SimpleNamespace(
            tokenizer=SimpleNamespace(encode=lambda _text: [1, 2])
        )

        def stream(**kwargs):
            calls.append(kwargs)
            try:
                yield SimpleNamespace(text="answer")
                if len(calls) == 2:
                    session.cancel.set()
                yield SimpleNamespace(text=" tail")
            finally:
                closed.append(True)

        library.stream_generate = stream
        with patch.dict(
            sys.modules,
            {"mlx_vlm": library, "mlx_vlm.prompt_utils": templates, "mlx_vlm.apc": apc},
        ):
            session.generate({"job_id": "first", "conversation_id": "A"})
            session.generate({"job_id": "second", "conversation_id": "A"})
            session.cancel.clear()
            session.generate({"job_id": "third", "conversation_id": "A"})
            session.unload()
        self.assertIn("apc_manager", calls[0])
        self.assertIs(calls[0]["apc_manager"], calls[1]["apc_manager"])
        self.assertIsNot(calls[1]["apc_manager"], calls[2]["apc_manager"])
        self.assertEqual(calls[0]["apc_tenant"], "A")
        self.assertNotIn("prompt_cache_state", calls[0])
        self.assertEqual(len(closed), 3)


if __name__ == "__main__":
    unittest.main()
