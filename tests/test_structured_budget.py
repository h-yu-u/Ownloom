"""Remaining output uses the exact rendered input, not a fixed Coding cap."""

import unittest
from types import SimpleNamespace

from mlx_studio_runtime.adapters.text_engines.structured_input import (
    ContextOverflow,
    prepare_input,
)
from mlx_studio_runtime.entrypoints.http.inference_contracts import InferenceRequest


class StructuredBudgetTests(unittest.TestCase):
    def payload(self, text="hello", **options):
        return {
            "messages": [{"role": "user", "content": text}],
            "tools": [],
            "max_tokens": None,
            "output_budget": "remaining",
            "context_limit": 32768,
            **options,
        }

    def test_remaining_budget_fills_window_and_shrinks_with_exact_input(self):
        session = SimpleNamespace(engine="fake", context_limit=131072)
        for text in ("hello", "中" * 12000):
            payload = self.payload(text)
            rendered, _, budget = prepare_input(session, payload)
            self.assertEqual(budget["inputTokens"], len(rendered))
            self.assertEqual(budget["contextLimit"], 32768)
            self.assertEqual(budget["outputReserve"], 32768 - len(rendered) - 128)
            self.assertGreater(budget["outputReserve"], 8192)
            self.assertIsNone(payload["max_tokens"])

    def test_model_limit_and_fixed_requests_remain_authoritative(self):
        session = SimpleNamespace(engine="fake", context_limit=4096)
        _, _, budget = prepare_input(session, self.payload())
        self.assertEqual(budget["contextLimit"], 4096)
        self.assertEqual(
            sum(
                budget[key] for key in ("inputTokens", "outputReserve", "safetyReserve")
            ),
            4096,
        )
        _, _, fixed = prepare_input(
            session, self.payload(output_budget="fixed", max_tokens=256)
        )
        self.assertEqual(fixed["outputReserve"], 256)
        with self.assertRaises(ContextOverflow):
            prepare_input(session, self.payload("x" * 4000))
        with self.assertRaises(ContextOverflow):
            prepare_input(session, self.payload(output_budget="fixed", max_tokens=4096))

    def test_provider_accepts_explicit_large_output_and_remaining_mode(self):
        request = InferenceRequest(
            model="fixture",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=16384,
        )
        self.assertEqual(request.max_tokens, 16384)
        request = InferenceRequest(model="fixture", **self.payload())
        self.assertEqual(request.output_budget, "remaining")
