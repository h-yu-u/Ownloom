"""A bounded DFlash feature snapshot must cover the same absolute prefix as KV/GDN."""

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import numpy as np
from mlx_studio_runtime.adapters.text_engines.coding_cache import DraftPrefix


class DFlashFeatureTests(unittest.TestCase):
    def setUp(self):
        mlx, core, nn = ModuleType("mlx"), ModuleType("mlx.core"), ModuleType("mlx.nn")
        mlx.core, mlx.nn = core, nn
        nn.Module = object
        core.array, core.concatenate, core.contiguous = (
            np.array,
            np.concatenate,
            np.ascontiguousarray,
        )
        core.eval = lambda *_: None
        path = (
            Path(__file__).parents[1]
            / "services/runtime/src/mlx_studio_runtime/adapters/text_engines/dflash2/prefill.py"
        )
        spec = importlib.util.spec_from_file_location("isolated_prefill_features", path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"mlx": mlx, "mlx.core": core, "mlx.nn": nn}):
            spec.loader.exec_module(module)
        self.capture = module._PrefillFeatures

    def target(self):
        layers = [object(), object(), object()]
        return SimpleNamespace(
            language_model=SimpleNamespace(model=SimpleNamespace(layers=layers))
        )

    def record(self, capture, start, stop):
        for index in range(2):
            capture.record(
                index, np.arange(start, stop).reshape(1, -1, 1) + index * 100
            )

    def test_restore_then_append_matches_cold_sliding_features_and_absolute_offset(
        self,
    ):
        first = self.capture(self.target(), [0, 2], 3)
        self.record(first, 0, 5)
        snapshot = first.snapshot()
        self.record(first, 5, 7)
        np.testing.assert_array_equal(snapshot.layers[0].reshape(-1), [2, 3, 4])
        first.close()
        warm_target = self.target()
        originals = list(warm_target.language_model.model.layers)
        warm = self.capture(warm_target, [0, 2], 3)
        warm.restore(snapshot)
        self.record(warm, 5, 9)
        warm_hidden, warm_offset, warm_count = warm.finish()
        cold = self.capture(self.target(), [0, 2], 3)
        self.record(cold, 0, 9)
        cold_hidden, cold_offset, cold_count = cold.finish()
        np.testing.assert_array_equal(warm_hidden, cold_hidden)
        self.assertEqual((warm_offset, warm_count), (cold_offset, cold_count))
        self.assertEqual((warm_offset, warm_count), (6, 9))
        self.assertEqual(warm_target.language_model.model.layers, originals)

    def test_incomplete_or_wrong_window_is_rejected_and_close_restores_layers(self):
        target = self.target()
        originals = list(target.language_model.model.layers)
        capture = self.capture(target, [0, 2], 3)
        try:
            with self.assertRaisesRegex(ValueError, "DFLASH_PREFIX_INCOMPLETE"):
                capture.snapshot()
            for bad in [
                DraftPrefix(5, (np.zeros((1, 3, 1)),)),
                DraftPrefix(5, (np.zeros((1, 2, 1)),) * 2),
            ]:
                with self.assertRaisesRegex(ValueError, "DFLASH_PREFIX_INVALID"):
                    capture.restore(bad)
        finally:
            capture.close()
        self.assertEqual(target.language_model.model.layers, originals)
