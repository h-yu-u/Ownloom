import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from mlx_studio_runtime.adapters.text_engines.prefix_cache import (
    MAX_PREFIX_TOKENS,
    MAX_SNAPSHOT_BYTES,
    BoundedExactCache,
    ChatPrefixCache,
    create_exact_cache,
)


class SnapshotBackend:
    exact_cache_guard_tokens = 16

    def __init__(self):
        self.entry = None
        self.closed = False
        self.stores = 0

    def store_exact_cache(self, token_ids, prompt_cache, *, extra_hash=0):
        self.entry = (tuple(token_ids), list(prompt_cache), extra_hash)
        self.stores += 1
        return True

    def lookup_exact_cache(self, token_ids, **kwargs):
        if self.entry:
            prefix, layers, tenant = self.entry
            if (
                tuple(token_ids[: len(prefix)]) == prefix
                and kwargs.get("extra_hash", 0) == tenant
            ):
                return layers, len(prefix)
        return None, 0

    def clear(self):
        self.entry = None

    def close(self):
        self.closed = True


class BoundedPrefixTests(unittest.TestCase):
    def setUp(self):
        self.backend = SnapshotBackend()
        self.cache = BoundedExactCache(self.backend)
        self.layers = [SimpleNamespace(nbytes=64, recurrent_state="must be preserved")]

    def test_guarded_snapshot_survives_whole_prompt_offer_and_regeneration(self):
        self.cache.begin()
        self.assertTrue(self.cache.store_exact_cache([1, 2], self.layers, extra_hash=9))
        self.assertFalse(
            self.cache.store_exact_cache([1, 2, 3], self.layers, extra_hash=9)
        )
        self.cache.begin()
        layers, length = self.cache.lookup_exact_cache([1, 2, 3], extra_hash=9)
        self.assertEqual(length, 2)
        self.assertEqual(layers[0].recurrent_state, "must be preserved")
        # Hybrid state need not expose trim(), even when history is edited.
        self.assertEqual(
            self.cache.lookup_exact_cache([1, 8, 3], extra_hash=9), (None, 0)
        )
        self.assertEqual(
            self.cache.lookup_exact_cache([1, 2, 3], extra_hash=10), (None, 0)
        )
        self.assertEqual(self.backend.stores, 1)

    def test_new_cold_request_replaces_the_only_retained_snapshot(self):
        for prefix in ([1, 2], [4, 5]):
            self.cache.begin()
            self.cache.store_exact_cache(prefix, self.layers)
        self.assertEqual(self.cache.lookup_exact_cache([1, 2, 3]), (None, 0))
        self.assertEqual(self.cache.lookup_exact_cache([4, 5, 6])[1], 2)

    def test_unknown_or_oversized_snapshots_are_not_cloned(self):
        for size in (None, -1, True, MAX_SNAPSHOT_BYTES + 1):
            with self.subTest(size=size):
                self.cache.begin()
                self.cache.store_exact_cache([1], self.layers)
                self.cache.begin()
                previous = self.backend.stores
                self.assertFalse(
                    self.cache.store_exact_cache([2], [SimpleNamespace(nbytes=size)])
                )
                self.assertEqual(self.backend.stores, previous)
                self.assertIsNone(self.backend.entry)

    def test_budget_sums_all_layers_and_limits_token_growth(self):
        self.assertFalse(
            self.cache.store_exact_cache(
                [1],
                [SimpleNamespace(nbytes=MAX_SNAPSHOT_BYTES), SimpleNamespace(nbytes=1)],
            )
        )
        long_tokens = [1] * (MAX_PREFIX_TOKENS + 1)
        self.assertFalse(self.cache.store_exact_cache(long_tokens, self.layers))
        self.assertTrue(self.cache.store_exact_cache([1], self.layers))
        self.assertEqual(self.cache.lookup_exact_cache(long_tokens)[1], 1)
        self.assertIsNotNone(self.backend.entry)

    def test_long_request_reuses_bounded_snapshot_and_caps_its_next_checkpoint(self):
        prefix = list(range(MAX_PREFIX_TOKENS))
        self.assertTrue(self.cache.store_exact_cache(prefix, self.layers))
        self.cache.begin()
        full = prefix + [9] * 2048
        self.assertEqual(self.cache.lookup_exact_cache(full)[1], MAX_PREFIX_TOKENS)
        self.assertEqual(self.cache.exact_cache_guard_tokens, 2048)
        self.assertEqual(self.backend.stores, 1)

    def test_long_cold_request_preserves_larger_volatile_suffix_guard(self):
        self.cache.exact_cache_guard_tokens = 4000
        self.assertEqual(self.cache.lookup_exact_cache([1] * 10000), (None, 0))
        self.assertEqual(self.cache.exact_cache_guard_tokens, 4000)

    def test_lookup_and_store_failure_disable_cache_without_exposing_prompt(self):
        for operation in ("lookup_exact_cache", "store_exact_cache"):
            with self.subTest(operation=operation):
                backend = SnapshotBackend()
                setattr(
                    backend, operation, Mock(side_effect=ValueError("private prompt"))
                )
                cache = BoundedExactCache(backend)
                with self.assertLogs(level="WARNING") as logs:
                    if operation.startswith("lookup"):
                        self.assertEqual(cache.lookup_exact_cache([1, 2]), (None, 0))
                    else:
                        self.assertFalse(cache.store_exact_cache([1], self.layers))
                self.assertTrue(cache.failed)
                self.assertTrue(backend.closed)
                self.assertNotIn("private prompt", " ".join(logs.output))
                self.assertFalse(cache.store_exact_cache([1], self.layers))


class CacheEligibilityTests(unittest.TestCase):
    def test_only_exact_models_create_a_memory_only_manager(self):
        module = ModuleType("mlx_vlm.apc")
        module.APCManager = Mock()
        model = SimpleNamespace(language_model=object())
        with patch.dict(sys.modules, {"mlx_vlm.apc": module}):
            for mode in (None, "block"):
                module.model_apc_mode = Mock(return_value=mode)
                self.assertIsNone(create_exact_cache(model))
                module.model_apc_mode.assert_called_once_with(model.language_model)
            module.APCManager.assert_not_called()
            module.model_apc_mode = Mock(return_value="exact")
            self.assertIsInstance(create_exact_cache(model), BoundedExactCache)
            module.APCManager.assert_called_once_with(num_blocks=1, disk=None)


class CacheOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.owner = ChatPrefixCache()
        self.backends = []

        def create(_model):
            backend = SnapshotBackend()
            self.backends.append(backend)
            return BoundedExactCache(backend)

        self.factory = patch(
            "mlx_studio_runtime.adapters.text_engines.prefix_cache.create_exact_cache",
            side_effect=create,
        )
        self.factory.start()
        self.addCleanup(self.factory.stop)
        self.addCleanup(self.owner.clear)

    def begin(self, conversation="A", **extra):
        self.owner.begin(
            object(), "mlx-vlm", {"conversation_id": conversation, **extra}
        )

    def test_success_reuses_only_the_same_conversation(self):
        self.begin()
        first = self.owner.options["apc_manager"]
        self.owner.finish(True)
        self.assertEqual(self.owner.options, {})
        self.begin()
        self.assertIs(self.owner.options["apc_manager"], first)
        self.begin("B")
        self.assertTrue(self.backends[0].closed)
        self.assertIsNot(self.owner.options["apc_manager"], first)
        self.assertEqual(self.owner.options["apc_tenant"], "B")

    def test_time_suffix_and_template_tokens_are_outside_the_snapshot(self):
        self.begin(cache_suffix="time")
        full = [1] * 100 + [2] * 30
        stable = [1] * 100 + [3] * 6
        self.owner.guard_suffix(full, stable)
        cache = self.owner.options["apc_manager"]
        self.assertEqual(cache.exact_cache_guard_tokens, 38)
        self.owner.finish(True)
        self.begin()
        self.assertEqual(cache.exact_cache_guard_tokens, 16)

    def test_failure_and_clear_release_state(self):
        for action in (lambda: self.owner.finish(False), self.owner.clear):
            self.begin()
            previous = self.backends[-1]
            action()
            self.assertTrue(previous.closed)
            self.assertEqual(self.owner.options, {})
            self.begin()
            self.assertIsNot(self.backends[-1], previous)

    def test_images_missing_scope_and_non_vlm_requests_bypass_and_clear(self):
        for payload in (
            {},
            {"conversation_id": ""},
            {"conversation_id": 1},
            {"conversation_id": "A", "image_paths": ["fixture.png"]},
        ):
            with self.subTest(payload=payload):
                self.begin()
                previous = self.backends[-1]
                self.owner.begin(object(), "mlx-vlm", payload)
                self.assertTrue(previous.closed)
                self.assertEqual(self.owner.options, {})
        self.begin()
        self.owner.begin(object(), "mlx-lm", {"conversation_id": "A"})
        self.assertEqual(self.owner.options, {})

    def test_cache_factory_failure_is_a_cold_fallback(self):
        with (
            patch(
                "mlx_studio_runtime.adapters.text_engines.prefix_cache.create_exact_cache",
                side_effect=ImportError("private details"),
            ),
            self.assertLogs(level="WARNING"),
        ):
            self.begin()
        self.assertEqual(self.owner.options, {})


if __name__ == "__main__":
    unittest.main()
