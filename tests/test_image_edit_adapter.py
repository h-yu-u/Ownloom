import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "services/runtime/src"))
from mlx_studio_runtime.adapters.image_engines.mflux_image import MfluxImageEngine
from mlx_studio_runtime.adapters.image_engines.worker_image import WorkerImageEngine
from test_mflux_image_adapter import fake_engine_modules


class EditingAdapterTests(unittest.TestCase):
    def test_complete_model_uses_edit_pipeline_and_receives_ordered_inputs(self):
        captured = {}
        callbacks = SimpleNamespace(in_loop=[])
        callbacks.register = callbacks.in_loop.append
        modules = fake_engine_modules(captured, callbacks)
        module = ModuleType("mflux.models.qwen21.variants.edit.qwen_image_21_edit")
        module.QwenImage21Edit = modules[
            "mflux.models.qwen21.variants.txt2img.qwen_image_21"
        ].QwenImage21
        modules[module.__name__] = module
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(sys.modules, modules),
            patch(
                "mlx_studio_runtime.adapters.image_engines.mflux_image.supports_qwen21_edit",
                return_value=True,
            ),
        ):
            engine = MfluxImageEngine(directory)
            engine.generate(
                {
                    "seed": 42,
                    "prompt": "edit",
                    "width": 64,
                    "height": 64,
                    "steps": 2,
                    "image_paths": ["first", "second"],
                    "mask_path": "mask",
                    "strength": 0.8,
                },
                Path(directory) / "output.png",
                lambda step: None,
            )
        self.assertEqual(captured["generation"]["image_paths"], ["first", "second"])
        self.assertEqual(captured["generation"]["mask_image"], "mask")
        self.assertEqual(captured["generation"]["strength"], 0.8)
        self.assertEqual(callbacks.in_loop, [])

    def test_worker_rejects_input_path_outside_managed_attachments(self):
        with (
            patch.dict(
                os.environ, {"MLX_STUDIO_IMAGE_OUTPUT_ROOT": "/tmp/edit-test/images"}
            ),
            self.assertRaisesRegex(ValueError, "IMAGE_REFERENCE_PATH_INVALID"),
        ):
            WorkerImageEngine._input_files({"image_paths": ["/tmp/private.png"]})


if __name__ == "__main__":
    unittest.main()
