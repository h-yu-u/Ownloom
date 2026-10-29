"""Locked VLM 0.6.14 fast-input contract, without weights or MLX hardware.

The native fast-input branch reads ``mask`` rather than ``attention_mask``.
Qwen derives positions from that full mask before slicing by the cache offset.
"""

import sys
import unittest
from unittest.mock import patch

import numpy as np
from prefill_fixtures import NativeInputs


class CodingPrefillContractTests(unittest.TestCase):
    def setUp(self):
        self.fixture = NativeInputs()
        self.addCleanup(self.fixture.cache.clear)
        self.modules = patch.dict(sys.modules, self.fixture.modules())
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def test_cold_and_warm_preserve_full_mask_for_absolute_suffix_positions(self):
        fixture = self.fixture
        for length in (100, 137):
            fixture.ids = np.arange(length).reshape(1, -1)
            fixture.mask = np.ones_like(fixture.ids)
            options = fixture.prepare()
            self.assertIs(options.get("mask"), fixture.mask)
            self.assertIs(options["input_ids"], fixture.ids)
            state = options["prompt_cache_state"]
            prefix = len(state.token_ids)
            # Locked Qwen get_rope_index + LanguageModel positional contract:
            # cumsum(full mask) supplies absolute positions, sliced by KV offset.
            positions = np.cumsum(options["mask"], axis=-1) - 1
            actual = positions[:, prefix:length]
            np.testing.assert_array_equal(actual, np.arange(prefix, length)[None])
            self.assertEqual(state.cache[0].offset, prefix)
        self.assertEqual(fixture.cache.cached_tokens, 84)

    def test_invalid_mask_and_media_tokens_bypass_manual_prefill(self):
        fixture = self.fixture
        for mask in (None, np.ones((1, 99)), np.zeros_like(fixture.ids)):
            with self.subTest(mask=mask):
                fixture.mask = mask
                self.assertEqual(fixture.prepare(), {})
                self.assertEqual(fixture.calls, [])
        fixture.mask = np.ones_like(fixture.ids)
        fixture.ids[0, 12] = 999999
        self.assertEqual(fixture.prepare(), {})
        self.assertEqual(fixture.calls, [])

    def test_cancel_before_prefill_never_saves_a_checkpoint(self):
        fixture = self.fixture
        fixture.session.cancel.set()
        with self.assertRaisesRegex(ValueError, "INFERENCE_CANCELLED"):
            fixture.prepare()
        self.assertEqual(fixture.cache.retained_tokens, 0)
        self.assertEqual(fixture.calls, [])

    def test_failed_warm_snapshot_store_keeps_actual_request_measurements(self):
        fixture = self.fixture
        fixture.prepare()
        fixture.ids = np.arange(137).reshape(1, -1)
        fixture.mask = np.ones_like(fixture.ids)
        backend = fixture.cache._backend
        with (
            patch.object(
                backend, "store_exact_cache", side_effect=ValueError("private")
            ),
            self.assertLogs(level="WARNING") as logs,
        ):
            options = fixture.prepare()
        self.assertNotIn("private", " ".join(logs.output))
        self.assertEqual(fixture.cache.cached_tokens, 84)
        self.assertEqual(fixture.cache.prompt_tokens, 137)
        self.assertEqual(fixture.cache.retained_tokens, 0)
        self.assertEqual(options["prompt_cache_state"].cache[0].offset, 121)


if __name__ == "__main__":
    unittest.main()
