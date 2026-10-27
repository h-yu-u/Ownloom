"""Driver registration and cancellation are independent of text Session internals."""

import unittest
from unittest.mock import patch

from mlx_studio_runtime.adapters.worker_runtime.context import WorkerContext
from mlx_studio_runtime.adapters.worker_runtime.drivers import TextDriver
from mlx_studio_runtime.adapters.worker_runtime.runtime import WorkerRuntime


class WorkerDriverTests(unittest.TestCase):
    def test_register_driver_without_changing_other_modalities(self):
        calls = []
        context = WorkerContext(lambda kind, payload: calls.append(kind))

        class TestDriver(TextDriver):
            def load(self, manifest):
                calls.append("custom.load")

            def generate_text(self, payload):
                self.context.cancel.set()
                calls.append("custom.generate")

            def close(self):
                calls.append("custom.close")

        runtime = WorkerRuntime(context, {"fixture": TestDriver})
        runtime.load({"id": "test", "task": "fixture", "engine": "fake"})
        runtime.generate_text({"job_id": "job"})
        self.assertTrue(context.cancel.is_set())
        with self.assertRaisesRegex(RuntimeError, "IMAGE_MODEL_NOT_LOADED"):
            runtime.generate_image({})
        runtime.unload()
        runtime.unload()
        self.assertEqual(calls.count("custom.close"), 1)
        self.assertIsNone(runtime.driver)
        self.assertEqual(calls[:3], ["model.loading", "custom.load", "model.loaded"])

    def test_speech_load_never_constructs_a_text_session(self):
        context = WorkerContext(lambda *_: None)
        with patch(
            "mlx_studio_runtime.adapters.worker_runtime.drivers.EngineSession",
            side_effect=AssertionError("text session must not be constructed"),
        ):
            runtime = WorkerRuntime(context)
            runtime.load(
                {
                    "id": "speech",
                    "task": "text-to-speech",
                    "engine": "fake",
                    "localPath": "",
                }
            )
            self.assertEqual(runtime.driver.kind, "speech")
            context.shutdown.set()
            self.assertTrue(runtime.context.shutdown.is_set())
            runtime.unload()

    def test_unregistered_task_is_rejected(self):
        runtime = WorkerRuntime(WorkerContext(lambda *_: None))
        with self.assertRaisesRegex(ValueError, "MODEL_TASK_UNSUPPORTED"):
            runtime.load({"id": "x", "task": "arbitrary-plugin", "engine": "fake"})
