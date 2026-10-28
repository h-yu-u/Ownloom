"""Chat projections and successful persistence use the final native measurements."""

import inspect
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.jobs import JobEvent
from runtime_fixtures import create_test_runtime

SOURCE = Path(__file__).parents[1] / "services/runtime/src"
MODEL = "native-fixture"
PARTIAL = {
    "source": "mlx-vlm",
    "generationTokens": 3,
    "generationTps": 127.5,
    "promptTokens": 12,
    "promptTps": 921.25,
    "cachedTokens": None,
}
FINAL = {**PARTIAL, "generationTps": 34.125, "cachedTokens": 4}


class ScriptedWorker:
    def __init__(self, frames, observe=None):
        self.frames, self.observe = frames, observe

    async def generate(self, job_id, *_args):
        for kind, payload in self.frames:
            yield {"type": kind, "payload": {"job_id": job_id, **payload}}
            if self.observe:
                result = self.observe(job_id, kind)
                if inspect.isawaitable(result):
                    await result

    async def stop(self):
        pass


def delta(text="answer", stats=PARTIAL):
    return "generation.delta", {"text": text, "generationStats": stats}


def complete(stats=FINAL):
    return "generation.completed", {
        "finish_reason": "length",
        "generation_tokens": 3,
        "generationStats": stats,
    }


class ChatGenerationStatsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "app.db"
        self.service = create_test_runtime(SQLiteRepositories(self.path), SOURCE)
        fixture = replace(
            self.service.catalog.models["builtin-fake-text"],
            id=MODEL,
            engine="mlx-vlm",
            local_path=self.directory.name,
        )
        self.service.catalog.models[MODEL] = fixture
        self.service.store.models.upsert(fixture.to_dict())
        self.conversation = await self.service.chat.create_conversation("Stats", MODEL)
        self.queue = await self.service.events.subscribe()

    async def asyncTearDown(self):
        await self.service.close()
        self.directory.cleanup()

    def use_worker(self, frames, observe=None):
        self.service.inference.worker = ScriptedWorker(frames, observe)
        self.service.inference.active_model_id = MODEL

    async def submit(self):
        return await self.service.chat.send_message(
            self.conversation["id"], "hello", MODEL, 16, 0
        )

    async def settle(self, sent):
        await self.service.scheduler.tasks[sent["jobId"]]
        return self.service.queries.job(sent["jobId"])

    def replies(self):
        return [
            item
            for item in self.service.queries.conversation(self.conversation["id"])[
                "messages"
            ]
            if item["role"] == "assistant"
        ]

    def events(self):
        items = []
        while not self.queue.empty():
            items.append(self.queue.get_nowait())
        return items

    async def test_live_empty_final_frame_and_durable_snapshots_agree(self):
        live = []

        def observe(job_id, kind):
            if kind == "generation.delta":
                live.append(self.service.queries.job(job_id))

        self.use_worker([delta(), delta("", FINAL), complete()], observe)
        sent = await self.submit()
        self.assertIsNone(self.service.queries.job(sent["jobId"])["generationStats"])
        snapshot = await self.settle(sent)
        self.assertEqual([item["text"] for item in live], ["answer", "answer"])
        self.assertEqual([item["textRevision"] for item in live], [1, 2])
        self.assertEqual([item["generationStats"] for item in live], [PARTIAL, FINAL])
        self.assertEqual(snapshot["generationStats"], FINAL)
        self.assertEqual(snapshot["textRevision"], 2)
        reply = self.replies()[0]
        self.assertEqual(reply["generationStats"], FINAL)
        self.assertEqual(reply["parameters"]["generationStats"], FINAL)
        self.assertEqual(reply["parameters"]["generationTokens"], 3)
        self.assertIsNone(self.service.lifecycle.generation_stats(sent["jobId"]))
        self.service.lifecycle.prune(set(), 0)
        pruned = self.service.queries.job(sent["jobId"])
        self.assertEqual(pruned["generationStats"], FINAL)
        self.assertEqual(pruned["textRevision"], 0)
        await self.service.close()
        self.service = create_test_runtime(SQLiteRepositories(self.path), SOURCE)
        self.assertEqual(self.replies()[0]["generationStats"], FINAL)
        restored = self.service.queries.job(sent["jobId"])
        self.assertEqual(restored["generationStats"], FINAL)
        self.assertEqual(restored["textRevision"], 0)
        self.assertEqual(restored["text"], "answer")

    async def test_completion_corrects_the_last_visible_frame_before_success(self):
        self.use_worker([delta(), complete()])
        sent = await self.submit()
        await self.settle(sent)
        events = self.events()
        deltas = [event for event in events if event.type == "generation.delta"]
        self.assertEqual([event.payload["text"] for event in deltas], ["answer", ""])
        self.assertEqual([event.payload["textRevision"] for event in deltas], [1, 2])
        self.assertEqual(deltas[-1].payload["generationStats"], FINAL)
        success = next(event for event in events if event.type == "job.succeeded")
        self.assertLess(events.index(deltas[-1]), events.index(success))
        self.assertEqual(self.replies()[0]["generationStats"], FINAL)

    async def test_missing_null_or_invalid_terminal_stats_clear_partial_measurements(
        self,
    ):
        for terminal in (
            {},
            {"generationStats": None},
            {"generationStats": {"source": "mlx-vlm", "generationTps": float("nan")}},
        ):
            with self.subTest(terminal=terminal):
                self.use_worker([delta(), ("generation.completed", terminal)])
                sent = await self.submit()
                snapshot = await self.settle(sent)
                deltas = [
                    event for event in self.events() if event.type == "generation.delta"
                ]
                self.assertEqual(deltas[-1].payload["text"], "")
                self.assertEqual(deltas[-1].payload["textRevision"], 2)
                self.assertIsNone(deltas[-1].payload["generationStats"])
                self.assertIsNone(snapshot["generationStats"])
                self.assertIsNone(self.replies()[-1]["generationStats"])
                self.assertNotIn("generationStats", self.replies()[-1]["parameters"])

    async def test_legacy_delta_preserves_live_stats_but_new_attempt_starts_unknown(
        self,
    ):
        live = []

        def observe(job_id, kind):
            if kind == "generation.delta":
                live.append(self.service.queries.job(job_id)["generationStats"])

        self.use_worker(
            [delta(), ("generation.delta", {"text": " tail"}), complete()], observe
        )
        first = await self.submit()
        await self.settle(first)
        self.assertEqual(live, [PARTIAL, PARTIAL])
        self.use_worker(
            [("generation.delta", {"text": "new"}), ("generation.completed", {})]
        )
        second = await self.service.chat.regenerate(self.conversation["id"], MODEL)
        self.assertIsNone(self.service.queries.job(second["jobId"])["generationStats"])
        snapshot = await self.settle(second)
        self.assertIsNone(snapshot["generationStats"])
        self.assertIsNone(self.replies()[0]["generationStats"])
        self.assertEqual(
            self.service.queries.job(first["jobId"])["generationStats"], FINAL
        )

    async def test_regenerate_owns_its_final_metrics_without_summing_previous_answer(
        self,
    ):
        self.use_worker([delta(), complete()])
        first = await self.submit()
        await self.settle(first)
        next_stats = {**FINAL, "generationTokens": 1, "generationTps": 11.25}
        self.use_worker([delta("replacement", next_stats), complete(next_stats)])
        second = await self.service.chat.regenerate(self.conversation["id"], MODEL)
        await self.settle(second)
        self.assertEqual(len(self.replies()), 1)
        self.assertEqual(self.replies()[0]["generationStats"], next_stats)
        self.assertEqual(
            self.service.queries.job(first["jobId"])["generationStats"], FINAL
        )

    async def test_live_projection_does_not_expose_mutable_lifecycle_state(self):
        def observe(job_id, kind):
            if kind == "generation.delta":
                snapshot = self.service.queries.job(job_id)
                snapshot["generationStats"]["generationTps"] = 999
                self.assertEqual(
                    self.service.queries.job(job_id)["generationStats"], PARTIAL
                )

        self.use_worker([delta(), complete(PARTIAL)], observe)
        await self.settle(await self.submit())
        self.assertEqual(self.replies()[0]["generationStats"], PARTIAL)

    async def test_legacy_history_and_malformed_metrics_remain_readable(self):
        self.use_worker(
            [("generation.delta", {"text": "old answer"}), ("generation.completed", {})]
        )
        sent = await self.submit()
        await self.settle(sent)
        self.assertIsNone(self.replies()[0]["generationStats"])
        malformed = {"source": ["mlx-vlm"], "generationTps": 99}
        self.service.store.conversations.save_message(
            {
                "id": "bad-metrics",
                "conversationId": self.conversation["id"],
                "role": "assistant",
                "content": "legacy",
                "parameters": {"generationStats": malformed},
            }
        )
        self.assertIsNone(self.replies()[-1]["generationStats"])

    async def test_cancel_winning_after_worker_completion_does_not_persist_success(
        self,
    ):
        self.use_worker([delta(), complete()])
        finalize = self.service.chat._finalize

        async def cancel_before_persist(job, *args):
            await self.service.lifecycle.transition(job.id, JobEvent.CANCEL_REQUESTED)
            self.assertIsNone(self.service.queries.job(job.id)["generationStats"])
            await finalize(job, *args)

        with patch.object(
            self.service.chat, "_finalize", side_effect=cancel_before_persist
        ):
            sent = await self.submit()
            snapshot = await self.settle(sent)
        self.assertEqual(snapshot["state"], "cancelled")
        self.assertIsNone(snapshot["generationStats"])
        self.assertIsNone(self.service.lifecycle.generation_stats(sent["jobId"]))
        self.assertEqual(self.replies(), [])
        self.assertFalse(any(event.type == "job.succeeded" for event in self.events()))

    async def test_failed_worker_does_not_turn_partial_stats_into_a_successful_answer(
        self,
    ):
        self.use_worker(
            [delta(), ("generation.failed", {"error_code": "TEST_FAILURE"})]
        )
        sent = await self.submit()
        snapshot = await self.settle(sent)
        self.assertEqual(snapshot["state"], "failed")
        self.assertIsNone(snapshot["generationStats"])
        self.assertIsNone(self.service.lifecycle.generation_stats(sent["jobId"]))
        self.assertEqual(self.replies(), [])

    async def test_failed_commit_rolls_back_replacement_and_metrics_together(self):
        self.use_worker([delta(), complete()])
        first = await self.submit()
        await self.settle(first)
        original = self.replies()[0]
        update = self.service.store.jobs.update

        def reject_success(job_id, state, error_code=None):
            if state == "succeeded":
                raise OSError("fixture commit failed after assistant insertion")
            return update(job_id, state, error_code)

        self.use_worker([delta("replacement"), complete()])
        with (
            patch.object(self.service.store.jobs, "update", side_effect=reject_success),
            self.assertLogs("mlx_studio.scheduler", level="ERROR"),
        ):
            second = await self.service.chat.regenerate(self.conversation["id"], MODEL)
            snapshot = await self.settle(second)
        self.assertEqual(snapshot["state"], "failed")
        self.assertIsNone(snapshot["generationStats"])
        self.assertEqual(self.replies(), [original])
        self.assertEqual(self.service.store.jobs.get(second["jobId"])["resultText"], "")
        self.assertEqual(
            self.service.queries.job(first["jobId"])["generationStats"], FINAL
        )
