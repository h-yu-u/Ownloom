import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.entrypoints.http.chat_contracts import ChatAttemptRequest
from mlx_studio_runtime.entrypoints.http.contracts import ChatMessageRequest
from runtime_fixtures import create_test_runtime

RUNTIME_SOURCE = Path(__file__).parents[1] / "services/runtime/src"


class CompletionTests(unittest.TestCase):
    def test_manual_limits_above_8192_are_accepted_by_both_chat_endpoints(self):
        self.assertEqual(
            ChatMessageRequest(
                content="hello", model_id="test", max_tokens=131072
            ).max_tokens,
            131072,
        )
        attempt = ChatAttemptRequest(
            client_request_id="retry",
            mode="local_only",
            model_id="test",
            max_tokens=131072,
        )
        self.assertEqual(attempt.max_tokens, 131072)

    def test_worker_sizes_automatic_output_from_tokenized_template_and_visual_input(
        self,
    ):
        session = EngineSession()
        session.context_limit = 262144
        tokenizer = Mock()
        tokenizer.encode.return_value = range(1000)
        self.assertEqual(session._check_budget(tokenizer, "rendered", None), 261016)
        self.assertEqual(
            session._check_budget(tokenizer, "rendered", None, 4096), 256920
        )
        self.assertEqual(session._check_budget(tokenizer, "rendered", 131072), 131072)
        with self.assertRaisesRegex(ValueError, "CONTEXT_BUDGET_EXCEEDED"):
            session._check_budget(tokenizer, "rendered", 262144)
        session.context_limit = 1024
        with self.assertRaisesRegex(ValueError, "CONTEXT_BUDGET_EXCEEDED"):
            session._check_budget(tokenizer, "rendered", None)

    def test_generation_does_not_silently_clamp_explicit_output_to_8192(self):
        session = EngineSession(emit=lambda *_: None)
        session.model_id = "test"
        chunks = Mock(return_value=iter([]))
        session._chunks = chunks
        session.generate({"job_id": "test", "max_tokens": 131072})
        self.assertEqual(chunks.call_args.args[2], 131072)
        chunks.return_value = iter([])
        session.generate({"job_id": "auto", "max_tokens": None})
        self.assertIsNone(chunks.call_args.args[2])

    def test_default_budget_and_length_metadata(self) -> None:
        self.assertIsNone(
            ChatMessageRequest(content="hello", model_id="test").max_tokens
        )
        events = []
        session = EngineSession()
        session.model_id = "test"
        session.emit = lambda kind, payload: events.append((kind, payload))

        def chunks(*_args):
            yield "partial"
            session.record_completion(
                SimpleNamespace(finish_reason="length", generation_tokens=8)
            )
            yield " tail"

        session._chunks = chunks
        session.generate({"job_id": "job", "max_tokens": 8})
        self.assertEqual(
            events[-1],
            (
                "generation.completed",
                {
                    "job_id": "job",
                    "finish_reason": "length",
                    "generation_tokens": 8,
                },
            ),
        )
        session._chunks = lambda *_args: iter(["done"])
        session.generate({"job_id": "next"})
        self.assertEqual(events[-1][1]["finish_reason"], "stop")


class CompletionPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepted_input_names_the_conversation_before_generation_finishes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "app.db")
            service = create_test_runtime(store, RUNTIME_SOURCE)
            try:
                conversation = await service.chat.create_conversation(
                    "新对话", "builtin-fake-text"
                )
                sent = await service.chat.send_message(
                    conversation["id"],
                    "帮我搭建一个图书馆系统",
                    "builtin-fake-text",
                    None,
                    0,
                )
                self.assertEqual(
                    store.conversations.list()[0]["title"], "帮我搭建一个图"
                )
                await service.scheduler.tasks[sent["jobId"]]
                self.assertEqual(
                    store.conversations.get(conversation["id"])["title"],
                    "帮我搭建一个图",
                )
            finally:
                await service.close()

    async def test_automatic_mode_survives_preparation_worker_persistence_and_context_reuse(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            service = create_test_runtime(
                SQLiteRepositories(Path(directory) / "app.db"), RUNTIME_SOURCE
            )
            try:
                conversation = await service.chat.create_conversation(
                    "Auto output", "builtin-fake-text"
                )
                sent = await service.chat.send_message(
                    conversation["id"], "hello", "builtin-fake-text", None, 0
                )
                await service.scheduler.tasks[sent["jobId"]]
                self.assertEqual(
                    service.queries.job(sent["jobId"])["state"], "succeeded"
                )
                answer = service.queries.conversation(conversation["id"])["messages"][
                    -1
                ]
                self.assertIsNone(answer["parameters"]["maxTokens"])
                snapshot = service.chat.preparation.contexts.load(
                    sent["jobId"], conversation["id"], sent["turnId"]
                )
                self.assertEqual(
                    snapshot["prompt"], snapshot["messages"][-1]["content"]
                )
                self.assertTrue(snapshot["prompt"].endswith(snapshot["cacheSuffix"]))
                self.assertEqual(
                    service.queries.conversation(conversation["id"])["messages"][0][
                        "content"
                    ],
                    "hello",
                )
                self.assertGreater(snapshot["budget"]["outputReserve"], 8192)
                reused = await service.chat.send_message(
                    conversation["id"],
                    "",
                    "builtin-fake-text",
                    None,
                    0,
                    operation="reuse_context",
                    target_user=sent["userMessageId"],
                    source_context_job_id=sent["jobId"],
                )
                await service.scheduler.tasks[reused["jobId"]]
                self.assertEqual(
                    service.queries.job(reused["jobId"])["state"], "succeeded"
                )
            finally:
                await service.close()

    async def test_length_reason_reaches_events_and_survives_reload(self) -> None:
        class Worker:
            async def generate(self, job_id, *_args):
                yield {
                    "type": "generation.delta",
                    "payload": {"job_id": job_id, "text": "partial"},
                }
                yield {
                    "type": "generation.completed",
                    "payload": {
                        "job_id": job_id,
                        "finish_reason": "length",
                        "generation_tokens": 8,
                    },
                }

            async def stop(self):
                pass

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.db"
            service = create_test_runtime(SQLiteRepositories(path), RUNTIME_SOURCE)
            service.inference.worker = Worker()  # type: ignore[assignment]
            service.inference.active_model_id = "builtin-fake-text"
            queue = await service.events.subscribe()
            conversation = await service.chat.create_conversation(
                "Test", "builtin-fake-text"
            )
            sent = await service.chat.send_message(
                conversation["id"], "hello", "builtin-fake-text", 8, 0
            )
            await service.scheduler.tasks[sent["jobId"]]
            events = []
            while not queue.empty():
                events.append(queue.get_nowait())
            terminal = next(event for event in events if event.type == "job.succeeded")
            self.assertEqual(terminal.payload["finish_reason"], "length")
            await service.close()
            reopened = SQLiteRepositories(path)
            try:
                reply = reopened.conversations.get(conversation["id"])["messages"][-1]
                self.assertEqual(reply["content"], "partial")
                self.assertEqual(reply["parameters"]["finishReason"], "length")
                self.assertEqual(reply["parameters"]["generationTokens"], 8)
            finally:
                reopened.close()
