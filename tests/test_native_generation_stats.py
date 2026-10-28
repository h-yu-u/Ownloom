"""Use native response fixtures without loading an MLX model or estimating a rate."""

import asyncio
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from mlx_studio_runtime import PROTOCOL_VERSION
from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.adapters.text_engines.structured import _generate_native
from mlx_studio_runtime.adapters.worker_host import WorkerHost
from mlx_studio_runtime.domain.generation_stats import read_generation_stats
from mlx_studio_runtime.entrypoints.http.chat_contracts import GenerationStats


def response(text="answer", **values):
    return SimpleNamespace(text=text, **values)


def native_events(engine, responses, session=None):
    session = session or EngineSession()
    events = []
    session.event_sink = lambda kind, payload: events.append((kind, payload))
    session.engine = engine
    session.model_id = "fixture"
    session.model = object()
    session.tokenizer = SimpleNamespace(
        encode=lambda _text: [1, 2],
        apply_chat_template=lambda *_args, **_kwargs: "rendered",
    )
    session.processor = SimpleNamespace(tokenizer=session.tokenizer)
    session.model_config = {}
    library = ModuleType(engine.replace("-", "_"))
    library.stream_generate = lambda *_args, **_kwargs: iter(responses)
    sampler = ModuleType("mlx_lm.sample_utils")
    sampler.make_sampler = lambda temp: temp
    templates = ModuleType("mlx_vlm.prompt_utils")
    templates.apply_chat_template = lambda *_args, **_kwargs: "rendered"
    with patch.dict(
        sys.modules,
        {
            engine.replace("-", "_"): library,
            "mlx_lm.sample_utils": sampler,
            "mlx_vlm.prompt_utils": templates,
        },
    ):
        session.generate({"job_id": "job", "prompt": "hello", "max_tokens": 16})
    return session, events


class NativeGenerationStatsTests(unittest.TestCase):
    def test_native_rates_are_preserved_including_an_empty_final_response(self):
        for engine in ("mlx-lm", "mlx-vlm"):
            with self.subTest(engine=engine):
                _, events = native_events(
                    engine,
                    [
                        response(
                            "answer",
                            generation_tokens=3,
                            generation_tps=127.5,
                            prompt_tokens=12,
                            prompt_tps=921.25,
                        ),
                        response(
                            "",
                            generation_tokens=3,
                            generation_tps=34.125,
                            prompt_tokens=12,
                            prompt_tps=921.25,
                            cached_tokens=4,
                            finish_reason="length",
                        ),
                    ],
                )
                deltas = [
                    payload for kind, payload in events if kind == "generation.delta"
                ]
                self.assertEqual([delta["text"] for delta in deltas], ["answer", ""])
                self.assertEqual(deltas[0]["generationStats"]["generationTps"], 127.5)
                expected = {
                    "source": engine,
                    "generationTokens": 3,
                    "generationTps": 34.125,
                    "promptTokens": 12,
                    "promptTps": 921.25,
                    "cachedTokens": 4,
                }
                self.assertEqual(deltas[-1]["generationStats"], expected)
                self.assertEqual(events[-1][1]["generationStats"], expected)
                self.assertEqual(events[-1][1]["generation_tokens"], 3)

    def test_invalid_native_scalars_remain_unknown_without_recomputation(self):
        _, events = native_events(
            "mlx-lm",
            [
                response(
                    generation_tokens=True,
                    generation_tps=float("inf"),
                    prompt_tokens=12,
                    prompt_tps=float("nan"),
                    cached_tokens=-2,
                )
            ],
        )
        self.assertEqual(
            events[-1][1]["generationStats"],
            {
                "source": "mlx-lm",
                "generationTokens": None,
                "generationTps": None,
                "promptTokens": 12,
                "promptTps": None,
                "cachedTokens": None,
            },
        )

    def test_fake_and_missing_statistics_do_not_claim_a_native_rate(self):
        for engine in ("fake", "mlx-lm", "mlx-vlm"):
            with self.subTest(engine=engine):
                _, events = native_events(engine, [response("visible text")])
                self.assertTrue(
                    all(payload.get("generationStats") is None for _, payload in events)
                )

    def test_native_zero_is_preserved_but_strings_and_fractional_counts_are_not(self):
        _, events = native_events(
            "mlx-vlm",
            [
                response(
                    generation_tokens=0,
                    generation_tps=0.0,
                    prompt_tokens=2.5,
                    prompt_tps="900",
                    cached_tokens=False,
                )
            ],
        )
        stats = events[-1][1]["generationStats"]
        self.assertEqual(stats["generationTokens"], 0)
        self.assertEqual(stats["generationTps"], 0.0)
        self.assertIsNone(stats["promptTokens"])
        self.assertIsNone(stats["promptTps"])
        self.assertIsNone(stats["cachedTokens"])

    def test_new_generation_does_not_reuse_previous_native_statistics(self):
        session, first = native_events(
            "mlx-lm", [response(generation_tokens=8, generation_tps=5.25)]
        )
        self.assertEqual(first[-1][1]["generationStats"]["generationTps"], 5.25)
        _, second = native_events("mlx-lm", [response("new answer")], session)
        self.assertTrue(
            all(payload.get("generationStats") is None for _, payload in second)
        )

    def test_empty_native_response_with_missing_or_invalid_stats_clears_previous_values(
        self,
    ):
        for engine in ("mlx-lm", "mlx-vlm"):
            for final in (response(""), response("", generation_tps=float("inf"))):
                with self.subTest(engine=engine, final=final):
                    _, events = native_events(
                        engine,
                        [response(generation_tokens=3, generation_tps=12.25), final],
                    )
                    deltas = [
                        payload
                        for kind, payload in events
                        if kind == "generation.delta"
                    ]
                    self.assertEqual(deltas[-1]["text"], "")
                    self.assertIn("generationStats", deltas[-1])
                    self.assertIsNone(deltas[-1]["generationStats"])
                    self.assertIsNone(events[-1][1].get("generationStats"))
                    json.dumps(events, allow_nan=False)

    def test_normalization_rejects_invalid_sources_and_preserves_partial_native_values(
        self,
    ):
        for source in ("fake", "unknown", None, True, [], {}):
            self.assertIsNone(
                read_generation_stats({"source": source, "generationTps": 1})
            )
        for value in (True, False, "9", -1, float("nan"), float("inf"), 10**1000):
            with self.subTest(value=repr(value)[:30]):
                stats = read_generation_stats(
                    {"source": "mlx-lm", "generationTokens": 0, "generationTps": value}
                )
                self.assertIsNone(stats["generationTps"])
                self.assertEqual(stats["generationTokens"], 0)
                self.assertEqual(
                    GenerationStats.model_validate(stats).model_dump(), stats
                )

    def test_structured_inference_does_not_start_publishing_chat_statistics(self):
        session = EngineSession(emit=lambda *_args: None)
        session.engine = "mlx-lm"
        session.model = object()
        session.tokenizer = object()
        library = ModuleType("mlx_lm")
        library.stream_generate = lambda *_args, **_kwargs: iter(
            [response("structured answer", generation_tokens=3, generation_tps=99.5)]
        )
        sampler = ModuleType("mlx_lm.sample_utils")
        sampler.make_sampler = lambda temp: temp
        with patch.dict(
            sys.modules, {"mlx_lm": library, "mlx_lm.sample_utils": sampler}
        ):
            result = _generate_native(
                session,
                "rendered",
                {"job_id": "job", "max_tokens": 16, "temperature": 0},
            )
        self.assertEqual(result, "structured answer")
        self.assertEqual(session.generation_tokens, 3)
        self.assertIsNone(getattr(session, "generation_stats", None))


class NativeStatsTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_ndjson_worker_transport_preserves_native_final_measurements(self):
        for engine in ("mlx-lm", "mlx-vlm"):
            with self.subTest(engine=engine):
                _, events = native_events(
                    engine,
                    [
                        response(generation_tokens=3, generation_tps=127.5),
                        response(
                            "",
                            generation_tokens=3,
                            generation_tps=34.125,
                            cached_tokens=0,
                        ),
                    ],
                )
                reader = asyncio.StreamReader()
                for seq, (kind, payload) in enumerate(events, 1):
                    frame = {
                        "protocol_version": PROTOCOL_VERSION,
                        "seq": seq,
                        "type": kind,
                        "payload": payload,
                    }
                    reader.feed_data(
                        (json.dumps(frame, allow_nan=False) + "\n").encode()
                    )
                reader.feed_eof()
                host = WorkerHost(Path(__file__).parents[1] / "services/runtime/src")
                host.process = SimpleNamespace(stdout=reader)
                received = [event async for event in host._events_until_terminal("job")]
                self.assertEqual(
                    [(event["type"], event["payload"]) for event in received], events
                )
