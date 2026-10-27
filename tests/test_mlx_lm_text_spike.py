import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

SPIKE_PATH = (
    Path(__file__).parents[1] / "spikes" / "mlx-lm-text" / "run_text_generation.py"
)
SPEC = importlib.util.spec_from_file_location("mlx_lm_text_spike", SPIKE_PATH)
assert SPEC is not None and SPEC.loader is not None
SPIKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SPIKE)


class StreamResponseTests(unittest.TestCase):
    def test_emits_text_and_returns_stream_metrics(self) -> None:
        fake_library = ModuleType("mlx_lm")
        fake_library.stream_generate = lambda *args, **kwargs: iter(
            [
                SimpleNamespace(
                    text="hello ",
                    generation_tokens=1,
                    generation_tps=10.0,
                    peak_memory=0.5,
                    finish_reason=None,
                ),
                SimpleNamespace(
                    text="world",
                    generation_tokens=2,
                    generation_tps=12.0,
                    peak_memory=0.6,
                    finish_reason="stop",
                ),
            ]
        )
        output = io.StringIO()
        with patch.dict(sys.modules, {"mlx_lm": fake_library}), redirect_stdout(output):
            metrics = SPIKE.stream_response(object(), object(), "prompt", 8)

        self.assertEqual(output.getvalue(), "hello world\n")
        self.assertEqual(metrics["stream_events"], 2)
        self.assertEqual(metrics["generated_tokens"], 2)
        self.assertEqual(metrics["finish_reason"], "stop")
        self.assertTrue(metrics["output_non_empty"])

    def test_rejects_empty_generation(self) -> None:
        fake_library = ModuleType("mlx_lm")
        fake_library.stream_generate = lambda *args, **kwargs: iter([])
        with (
            patch.dict(sys.modules, {"mlx_lm": fake_library}),
            redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(RuntimeError, "no generated text"),
        ):
            SPIKE.stream_response(object(), object(), "prompt", 8)


if __name__ == "__main__":
    unittest.main()
