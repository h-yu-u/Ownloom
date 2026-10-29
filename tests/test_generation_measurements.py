"""Measured Worker intervals and prior-request cache reuse survive the provider boundary."""

import asyncio
import json
import unittest
from types import SimpleNamespace

from mlx_studio_runtime.adapters.text_engines.generation_measurements import (
    GenerationMeasurements,
)
from mlx_studio_runtime.domain.generation_stats import read_generation_stats
from mlx_studio_runtime.entrypoints.http.provider_stream import stream_result


class GenerationMeasurementsTests(unittest.TestCase):
    def test_manual_prefill_is_not_misreported_as_prior_request_cache_reuse(self):
        now = [1.0]
        metrics = GenerationMeasurements(lambda: now[0])
        metrics.begin()
        metrics.draft({"draft_model": object(), "draft_kind": "dflash"})
        now[0] = 1.25
        metrics.observe(
            "mlx-vlm",
            SimpleNamespace(
                token=1,
                generation_tokens=1,
                generation_tps=42.5,
                prompt_tokens=16,
                cached_tokens=184,
                prompt_tps=99.5,
            ),
        )
        prefix = SimpleNamespace(prompt_tokens=200, cached_tokens=84)
        pending = metrics.result(prefix)
        self.assertEqual(pending["promptTokens"], 200)
        self.assertEqual(pending["cachedTokens"], 84)
        self.assertEqual(pending["prefillTokens"], 116)
        self.assertEqual(pending["prefillMs"], 250)
        self.assertIsNone(pending["firstTokenMs"])
        self.assertIsNone(pending["durationMs"])
        now[0] = 1.5
        metrics.visible_text("")
        self.assertIsNone(metrics.result(prefix)["firstTokenMs"])
        metrics.visible_text("visible")
        now[0] = 2.0
        metrics.finish()
        final = metrics.result(prefix)
        self.assertEqual(final["firstTokenMs"], 500)
        self.assertEqual(final["durationMs"], 1000)
        self.assertEqual(final["generationTps"], 42.5)
        self.assertEqual(final["promptTps"], 99.5)
        self.assertEqual(final["draftMode"], "dflash2")
        self.assertEqual(read_generation_stats(final), final)

    def test_missing_native_data_never_becomes_a_measurement_and_requests_reset(self):
        metrics = GenerationMeasurements(lambda: 1.0)
        prefix = SimpleNamespace(prompt_tokens=None, cached_tokens=None)
        metrics.begin()
        metrics.draft({"draft_kind": "mtp", "draft_model": object()})
        metrics.observe("mlx-lm", SimpleNamespace(generation_tps=12))
        self.assertEqual(metrics.result(prefix)["draftMode"], "mtp")
        self.assertIsNone(metrics.result(prefix)["prefillMs"])
        metrics.begin()
        metrics.visible_text("visible")
        metrics.finish()
        self.assertIsNone(metrics.result(prefix))
        metrics.observe("fake", SimpleNamespace(generation_tps=123))
        self.assertIsNone(metrics.result(prefix))
        metrics.observe("mlx-lm", SimpleNamespace(generation_tokens=0))
        self.assertEqual(metrics.result(prefix)["draftMode"], "none")
        self.assertIsNone(metrics.result(prefix)["prefillTokens"])
        metrics.observe("mlx-lm", SimpleNamespace())
        self.assertIsNone(metrics.result(prefix))

    def test_new_fields_keep_invalid_or_legacy_values_unknown(self):
        legacy = read_generation_stats({"source": "mlx-lm", "generationTokens": 3})
        self.assertNotIn("durationMs", legacy)
        for invalid in (True, "12", -1, float("nan"), float("inf")):
            value = read_generation_stats(
                {
                    **legacy,
                    "draftMode": "auto",
                    "prefillMs": invalid,
                    "firstTokenMs": invalid,
                    "durationMs": invalid,
                    "prefillTokens": invalid,
                }
            )
            for key in (
                "draftMode",
                "prefillMs",
                "firstTokenMs",
                "durationMs",
                "prefillTokens",
            ):
                self.assertIsNone(value[key])


class ProviderMeasurementsTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_metadata_is_sent_only_after_the_result_commits(self):
        gate = asyncio.Event()
        queue = asyncio.Queue()
        stats = {"source": "mlx-vlm", "generationTps": 21.5, "cachedTokens": 84}

        async def complete():
            await gate.wait()
            return {
                "message": {"role": "assistant", "content": "answer"},
                "finish_reason": "stop",
                "input_tokens": 200,
                "generation_tokens": 7,
                "generationStats": stats,
            }

        task = asyncio.create_task(complete())
        stream = stream_result(task, queue, {"id": "fixture"})
        first = await anext(stream)
        self.assertNotIn("ownloom", first)
        gate.set()
        frames = [item async for item in stream]
        metadata = [json.loads(item[6:]) for item in frames if '"ownloom"' in item]
        self.assertEqual(len(metadata), 1)
        self.assertEqual(metadata[0]["choices"], [])
        self.assertEqual(
            metadata[0]["ownloom"]["generationStats"], read_generation_stats(stats)
        )
        self.assertEqual(frames[-1], "data: [DONE]\n\n")
