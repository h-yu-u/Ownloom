"""Warm checkpoint advancement must retain only stable, independently owned state."""

import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import numpy as np
from mlx_studio_runtime.adapters.text_engines.chat_prefill import prepare_chat_prefix
from mlx_studio_runtime.adapters.text_engines.prefix_cache import (
    MAX_PREFIX_TOKENS,
    ChatPrefixCache,
)
from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from prefill_fixtures import NativeInputs


class ChatPrefillContractTests(unittest.TestCase):
    def setUp(self):
        self.fixture = NativeInputs()
        self.owner = self.fixture.session.prefix_cache = ChatPrefixCache()
        self.addCleanup(self.owner.clear)
        self.modules = patch.dict(sys.modules, self.fixture.modules())
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def prepare(self, length, conversation="one", guard=16):
        fixture = self.fixture
        fixture.ids = np.arange(length).reshape(1, -1)
        fixture.mask = np.ones_like(fixture.ids)
        self.owner.begin(
            fixture.session.model, "mlx-vlm", {"conversation_id": conversation}
        )
        self.owner.options["apc_manager"].exact_cache_guard_tokens = guard
        return prepare_chat_prefix(fixture.session, "rendered")

    def test_warm_checkpoint_advances_without_recomputing_its_retained_prefix(self):
        first = self.prepare(100)
        self.assertEqual(self.owner.cached_tokens, 0)
        self.assertEqual(self.owner.prompt_tokens, 100)
        self.assertEqual(len(first["prompt_cache_state"].token_ids), 84)
        # Native generation may mutate its working copy, never the retained state.
        first["prompt_cache_state"].cache[0].offset = 10000
        self.owner.finish(True)
        self.fixture.calls.clear()
        second = self.prepare(1200)
        self.assertEqual(self.owner.cached_tokens, 84)
        self.assertEqual(self.owner.prompt_tokens, 1200)
        self.assertEqual(len(second["prompt_cache_state"].token_ids), 1184)
        seen = np.concatenate([ids.reshape(-1) for ids, _ in self.fixture.calls])
        np.testing.assert_array_equal(seen, np.arange(84, 1184))
        self.owner.finish(True)
        third = self.prepare(1300)
        self.assertEqual(self.owner.cached_tokens, 1184)
        self.assertEqual(len(third["prompt_cache_state"].token_ids), 1184)

    def test_subthreshold_growth_avoids_snapshot_copy_and_manual_prefill(self):
        self.prepare(100)
        self.owner.finish(True)
        self.fixture.calls.clear()
        cache = self.owner._cache
        with patch.object(
            cache.backend, "store_exact_cache", wraps=cache.backend.store_exact_cache
        ) as store:
            result = self.prepare(300)
        store.assert_not_called()
        self.assertEqual(self.fixture.calls, [])
        self.assertEqual(len(result["prompt_cache_state"].token_ids), 84)
        self.assertEqual(self.owner.cached_tokens, 84)

    def test_long_requests_reuse_a_snapshot_capped_independently_of_request_length(
        self,
    ):
        first = self.prepare(10000)
        self.assertEqual(len(first["prompt_cache_state"].token_ids), MAX_PREFIX_TOKENS)
        self.assertIs(first["mask"], self.fixture.mask)
        self.owner.finish(True)
        self.fixture.calls.clear()
        later = self.prepare(20000)
        self.assertEqual(self.owner.cached_tokens, MAX_PREFIX_TOKENS)
        self.assertEqual(self.owner.prompt_tokens, 20000)
        self.assertEqual(len(later["prompt_cache_state"].token_ids), MAX_PREFIX_TOKENS)
        self.assertEqual(self.fixture.calls, [])

    def test_stable_boundary_excludes_clock_and_template_suffix_when_advancing(self):
        first = self.prepare(1000, guard=208)
        self.assertEqual(len(first["prompt_cache_state"].token_ids), 792)
        self.owner.finish(True)
        second = self.prepare(2000, guard=208)
        self.assertEqual(len(second["prompt_cache_state"].token_ids), 1792)
        self.assertEqual(self.owner.cached_tokens, 792)
        self.assertIs(second["mask"], self.fixture.mask)

    def test_scope_change_cancel_and_unsupported_inputs_release_owned_state(self):
        self.prepare(100)
        self.owner.finish(True)
        self.prepare(1200, conversation="two")
        self.assertEqual(self.owner.cached_tokens, 0)
        self.owner.finish(False)
        self.assertIsNone(self.owner.cached_tokens)
        self.assertIsNone(self.owner.prompt_tokens)
        self.fixture.mask = None
        self.owner.begin(
            self.fixture.session.model, "mlx-vlm", {"conversation_id": "two"}
        )
        self.assertEqual(prepare_chat_prefix(self.fixture.session, "rendered"), {})
        self.assertEqual(self.owner.options, {})

    def test_other_exact_models_keep_the_native_apc_path(self):
        self.fixture.session.model.config.model_type = "another_exact_model"
        self.owner.begin(
            self.fixture.session.model, "mlx-vlm", {"conversation_id": "one"}
        )
        options = dict(self.owner.options)
        self.assertEqual(prepare_chat_prefix(self.fixture.session, "rendered"), options)
        self.assertEqual(self.fixture.calls, [])

    def test_template_change_and_edited_history_start_from_a_cold_prefix(self):
        self.prepare(100)
        self.owner.finish(True)
        self.fixture.session.processor.tokenizer.chat_template = "changed template"
        self.prepare(1200)
        self.assertEqual(self.owner.cached_tokens, 0)
        self.owner.finish(True)
        self.owner.begin(
            self.fixture.session.model, "mlx-vlm", {"conversation_id": "one"}
        )
        self.fixture.ids[0, 0] = 99998
        result = prepare_chat_prefix(self.fixture.session, "edited")
        self.assertEqual(self.owner.cached_tokens, 0)
        self.assertEqual(result["prompt_cache_state"].token_ids[0], 99998)

    def test_cache_lookup_failure_disables_reuse_without_exposing_content(self):
        self.prepare(100)
        self.owner.finish(True)
        backend = self.owner._cache.backend
        with (
            patch.object(
                backend, "lookup_exact_cache", side_effect=ValueError("private")
            ),
            self.assertLogs(level="WARNING") as logs,
        ):
            self.assertEqual(self.prepare(1200), {})
        self.assertNotIn("private", " ".join(logs.output))
        self.assertEqual(self.owner.options, {})

    def test_prefill_failure_and_cancellation_do_not_keep_a_new_checkpoint(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                self.prepare(100)
                self.owner.finish(True)
                self.fixture.session.cancel.clear()
                if cancel:
                    self.fixture.session.cancel.set()
                with (
                    patch.object(
                        self.fixture.session.model,
                        "language_model",
                        side_effect=RuntimeError("forward failed"),
                    ),
                    self.assertRaises((ValueError, RuntimeError)),
                ):
                    self.prepare(1200)
                self.owner.finish(False)
                self.assertIsNone(self.owner.cached_tokens)
                self.assertEqual(self.owner.options, {})
                self.fixture.session.cancel.clear()

    def test_uncacheable_short_stable_prefix_does_not_capture_the_volatile_suffix(self):
        self.assertEqual(self.prepare(100, guard=95), {})
        self.assertEqual(self.owner.options, {})
        self.assertEqual(self.fixture.calls, [])

    def test_engine_hands_native_the_full_mask_and_reports_only_previous_reuse(self):
        events = []
        engine = EngineSession(emit=lambda kind, value: events.append((kind, value)))
        self.addCleanup(engine.unload)
        engine.engine, engine.model_id = "mlx-vlm", "fixture"
        engine.model, engine.processor = (
            self.fixture.session.model,
            self.fixture.session.processor,
        )
        engine.processor.tokenizer.encode = lambda _: self.fixture.ids.reshape(
            -1
        ).tolist()
        library, templates = ModuleType("mlx_vlm"), ModuleType("mlx_vlm.prompt_utils")
        templates.apply_chat_template = lambda *_args, **_kwargs: "rendered"

        def stream(**options):
            self.assertIs(options["mask"], self.fixture.mask)
            yield SimpleNamespace(
                text="answer",
                generation_tokens=1,
                generation_tps=5,
                prompt_tokens=self.fixture.ids.size,
                cached_tokens=len(options["prompt_cache_state"].token_ids),
            )

        library.stream_generate = stream
        with patch.dict(
            sys.modules, {"mlx_vlm": library, "mlx_vlm.prompt_utils": templates}
        ):
            for length, reused in ((100, 0), (1200, 84)):
                self.fixture.ids = np.arange(length).reshape(1, -1)
                self.fixture.mask = np.ones_like(self.fixture.ids)
                engine.generate(
                    {"job_id": str(length), "conversation_id": "one", "max_tokens": 16}
                )
                self.assertEqual(events[-1][0], "generation.completed")
                stats = events[-1][1]["generationStats"]
                self.assertEqual(stats["cachedTokens"], reused)
                self.assertEqual(stats["promptTokens"], length)
                self.assertEqual(stats["prefillTokens"], length - reused)


if __name__ == "__main__":
    unittest.main()
