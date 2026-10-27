import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "runtime" / "src"))

from mlx_studio_runtime.adapters.image_engines.fake_image import write_fake_png
from mlx_studio_runtime.adapters.image_engines.mflux_image import MfluxImageEngine
from mlx_studio_runtime.adapters.image_files import validate_png


def fake_engine_modules(captured, callbacks):
    class FakeFlux:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.callbacks = callbacks

        def generate_image(self, **kwargs):
            captured["generation"] = kwargs
            for step in range(kwargs["num_inference_steps"]):
                for callback in list(callbacks.in_loop):
                    callback.call_in_loop(t=step)
            return SimpleNamespace(
                save=lambda path: write_fake_png(
                    Path(path),
                    kwargs["width"],
                    kwargs["height"],
                    kwargs["seed"],
                )
            )

    config_module = ModuleType("mflux.models.common.config")
    config_module.ModelConfig = SimpleNamespace(
        dev=lambda: "dev", schnell=lambda: "schnell", qwen_image_21=lambda: "qwen21"
    )
    flux_module = ModuleType("mflux.models.flux.variants.txt2img.flux")
    flux_module.Flux1 = FakeFlux
    qwen_module = ModuleType("mflux.models.qwen21.variants.txt2img.qwen_image_21")
    qwen_module.QwenImage21 = FakeFlux
    modules = {
        "mflux.models.common.config": config_module,
        "mflux.models.flux.variants.txt2img.flux": flux_module,
        "mflux.models.qwen21.variants.txt2img.qwen_image_21": qwen_module,
    }
    return modules


class MfluxAdapterTests(unittest.TestCase):
    def test_qwen21_uses_its_own_pipeline_and_keeps_local_bf16_precision(self):
        captured = {}
        callbacks = SimpleNamespace(in_loop=[])
        callbacks.register = lambda callback: callbacks.in_loop.append(callback)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.json").write_text(
                json.dumps({"model_type": "qwen_image_21"})
            )
            with patch.dict(sys.modules, fake_engine_modules(captured, callbacks)):
                engine = MfluxImageEngine(str(root))
                progress = []
                engine.generate(
                    {
                        "seed": 42,
                        "prompt": "teapot",
                        "width": 64,
                        "height": 64,
                        "steps": 2,
                    },
                    root / "test.png",
                    progress.append,
                )
            self.assertEqual(captured["model_config"], "qwen21")
            self.assertEqual(captured["model_path"], str(root))
            self.assertNotIn("quantize", captured)
            self.assertEqual(progress, [1, 2])
            self.assertEqual(callbacks.in_loop, [])

    def test_local_metadata_controls_variant_and_current_api_receives_parameters(self):
        captured = {}
        callbacks = SimpleNamespace(in_loop=[])
        callbacks.register = lambda callback: callbacks.in_loop.append(callback)

        modules = fake_engine_modules(captured, callbacks)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "transformer").mkdir()
            (root / "model_index.json").write_text(
                json.dumps({"_class_name": "FluxPipeline"})
            )
            (root / "transformer" / "config.json").write_text(
                json.dumps({"guidance_embeds": False})
            )
            output = root / "output.png"
            parameters = {
                "seed": 0,
                "prompt": "test",
                "width": 80,
                "height": 64,
                "steps": 2,
            }
            with patch.dict(sys.modules, modules), patch.dict(os.environ, {}):
                engine = MfluxImageEngine(str(root))
                progress = []
                engine.generate(parameters, output, progress.append)
            self.assertEqual(captured["model_config"], "schnell")
            self.assertEqual(captured["model_path"], str(root))
            self.assertEqual(captured["generation"]["seed"], 0)
            self.assertEqual(captured["generation"]["num_inference_steps"], 2)
            self.assertEqual(progress, [1, 2])
            self.assertEqual(callbacks.in_loop, [])
            validate_png(output, 80, 64)

    def test_cancel_callback_is_removed_even_when_generation_raises(self):
        callbacks = SimpleNamespace(in_loop=[])
        callbacks.register = lambda callback: callbacks.in_loop.append(callback)
        engine = MfluxImageEngine.__new__(MfluxImageEngine)
        engine.model = SimpleNamespace(callbacks=callbacks)

        def generate(**_kwargs):
            callbacks.in_loop[0].call_in_loop(t=0)

        engine.model.generate_image = generate

        def cancel(_step):
            raise InterruptedError("cancelled")

        with self.assertRaises(InterruptedError):
            engine.generate(
                {"seed": 0, "prompt": "test", "width": 64, "height": 64, "steps": 1},
                Path("unused.png"),
                cancel,
            )
        self.assertEqual(callbacks.in_loop, [])
