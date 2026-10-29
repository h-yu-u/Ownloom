"""Exact recurrent snapshots and draft features advance together, never trim."""

import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from mlx_studio_runtime.adapters.text_engines.coding_cache import (
    MAX_CODING_CACHE_BYTES,
    CodingPrefixCache,
    DraftPrefix,
)
from mlx_studio_runtime.adapters.text_engines.coding_prefill import (
    prepare_coding_prefix,
)
from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.adapters.text_engines.structured import generate_structured
from mlx_studio_runtime.entrypoints.http.provider_stream import usage


class Backend:
    def __init__(self):
        self.entry = None
        self.closed = False

    def store_exact_cache(self, tokens, layers, **kwargs):
        self.entry = (tuple(tokens), deepcopy(layers))
        return True

    def lookup_exact_cache(self, tokens, **kwargs):
        if self.entry:
            prefix, layers = self.entry
            if tuple(tokens[: len(prefix)]) == prefix and len(prefix) <= kwargs.get(
                "max_prefix_tokens", len(tokens) - 1
            ):
                return deepcopy(layers), len(prefix)
        return None, 0

    def clear(self):
        self.entry = None

    def close(self):
        self.closed = True


class CodingCacheTests(unittest.TestCase):
    def setUp(self):
        self.cache = CodingPrefixCache()
        self.backends = []

        def factory():
            backend = Backend()
            self.backends.append(backend)
            return backend

        self.factory = factory
        self.addCleanup(self.cache.clear)

    def begin(self, scope="coding:A", identity="model-draft-template-tools"):
        self.cache.begin(scope, identity, self.factory)

    def save(self, tokens, size=100):
        layers = [SimpleNamespace(nbytes=size, state=[len(tokens)])]
        features = DraftPrefix(len(tokens), (SimpleNamespace(nbytes=20),))
        self.assertTrue(self.cache.store(tokens, layers, features))
        layers[0].state[0] = -1

    def test_long_history_reuses_exact_state_and_advances_checkpoint(self):
        self.begin()
        tokens = list(range(14000))
        self.save(tokens)
        self.cache.finish(True)
        self.begin()
        layers, length, features = self.cache.restore(tokens + [1, 2], 14001)
        self.assertEqual(length, 14000)
        self.assertEqual(layers[0].state, [14000])
        self.assertEqual(features.tokens, length)
        self.assertEqual(self.cache.cached_tokens, length)
        self.save(tokens + [1])
        self.cache.finish(True)
        self.begin()
        self.assertEqual(self.cache.restore(tokens + [1, 2], 14001)[1], 14001)
        self.assertEqual(len(self.backends), 1)

    def test_history_edits_and_shorter_prompts_do_not_trim_recurrent_state(self):
        self.begin()
        self.save([1, 2, 3])
        for tokens, boundary in [([1, 7, 3, 4], 3), ([1, 2], 1)]:
            self.begin()
            self.assertEqual(self.cache.restore(tokens, boundary), (None, 0, None))
            self.assertEqual(self.cache.cached_tokens, 0)

    def test_scope_or_semantics_change_and_cancel_release_snapshot(self):
        for scope, identity in [
            ("coding:B", "model-draft-template-tools"),
            ("coding:A", "changed"),
        ]:
            self.begin()
            self.save([1, 2])
            previous = self.backends[-1]
            self.begin(scope, identity)
            self.assertTrue(previous.closed)
            self.assertEqual(self.cache.restore([1, 2, 3], 2), (None, 0, None))
        self.save([1, 2])
        self.cache.finish(False)
        self.assertTrue(self.backends[-1].closed)
        self.assertEqual(self.cache.retained_tokens, 0)

    def test_limits_include_draft_features_and_reject_misaligned_features(self):
        self.begin()
        for size, features in [
            (MAX_CODING_CACHE_BYTES, DraftPrefix(2, (SimpleNamespace(nbytes=1),))),
            (1, DraftPrefix(1, (SimpleNamespace(nbytes=1),))),
            (None, None),
        ]:
            self.assertFalse(
                self.cache.store([1, 2], [SimpleNamespace(nbytes=size)], features)
            )
            self.assertEqual(self.cache.retained_tokens, 0)
        self.assertFalse(
            self.cache.store(list(range(32769)), [SimpleNamespace(nbytes=1)], None)
        )

    def test_optional_cache_failure_stays_cold_and_does_not_log_private_data(self):
        self.begin()

        def fail(*args, **kwargs):
            raise ValueError("private prompt")

        self.backends[-1].lookup_exact_cache = fail
        with self.assertLogs(level="WARNING") as logs:
            self.assertEqual(self.cache.restore([1, 2], 1), (None, 0, None))
        self.assertNotIn("private prompt", " ".join(logs.output))
        self.assertTrue(self.backends[-1].closed)

    def test_provider_usage_reports_actual_reused_input_without_subtracting_total(self):
        result = usage(
            {"input_tokens": 14626, "generation_tokens": 70, "cached_tokens": 14000}
        )
        self.assertEqual(result["prompt_tokens"], 14626)
        self.assertEqual(result["total_tokens"], 14696)
        self.assertEqual(result["prompt_tokens_details"], {"cached_tokens": 14000})

    def test_failed_parsing_and_cancel_do_not_retain_a_pending_checkpoint(self):
        for failure in ("parse", "cancel"):
            events = []
            session = EngineSession(
                emit=lambda kind, value, events=events: events.append(kind)
            )
            session.engine = "mlx-vlm"
            session.coding_cache = self.cache
            self.begin()
            self.save([1, 2])

            def generate(*_, failure=failure, session=session):
                if failure == "cancel":
                    session.cancel.set()
                return "<tool_call>broken"

            with (
                patch(
                    "mlx_studio_runtime.adapters.text_engines.structured.prepare_input",
                    return_value=(
                        "input",
                        "json",
                        {"inputTokens": 3, "outputReserve": 16},
                    ),
                ),
                patch(
                    "mlx_studio_runtime.adapters.text_engines.structured._generate_native",
                    side_effect=generate,
                ),
            ):
                generate_structured(
                    session, {"job_id": "j", "tools": [], "max_tokens": 16}
                )
            self.assertEqual(self.cache.retained_tokens, 0)
            self.assertIn(events[-1], ["generation.failed", "generation.cancelled"])

    def test_normal_chat_and_unload_release_coding_snapshot(self):
        session = EngineSession(emit=lambda *_: None)
        session.model_id = "fake"
        session.coding_cache = Mock()
        session.generate({"job_id": "chat", "prompt": "hi"})
        session.coding_cache.clear.assert_called_once_with()
        session.unload()
        self.assertEqual(session.coding_cache.clear.call_count, 2)

    def test_unsupported_model_unscoped_and_summary_requests_release_cache(self):
        for model_type, payload in [
            ("qwen3_5_moe", {"cache_scope": "coding:A", "tools": [{}]}),
            ("qwen3_5", {"tools": [{}]}),
            ("qwen3_5", {"cache_scope": "coding:A", "tools": []}),
        ]:
            self.begin()
            self.save([1, 2])
            session = SimpleNamespace(
                model=SimpleNamespace(config=SimpleNamespace(model_type=model_type)),
                coding_cache=self.cache,
            )
            self.assertEqual(prepare_coding_prefix(session, "fixture", payload), {})
            self.assertEqual(self.cache.retained_tokens, 0)
