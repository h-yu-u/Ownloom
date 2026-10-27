import asyncio
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, patch

from mlx_studio_runtime.adapters.event_hub import EventHub
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.jobs import JobState
from mlx_studio_runtime.domain.models import fake_text_manifest
from runtime_fixtures import create_test_runtime

RUNTIME_SOURCE = Path(__file__).parents[1] / "services/runtime/src"


class ConsistencyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.service = create_test_runtime(
            SQLiteRepositories(Path(self.directory.name) / "app.db"), RUNTIME_SOURCE
        )
        self.conversation = await self.service.chat.create_conversation(
            "Test", "builtin-fake-text"
        )

    async def asyncTearDown(self):
        await self.service.close()
        self.directory.cleanup()

    async def test_submission_failure_rolls_back_user_job_and_request_key(self):
        with (
            patch.object(
                self.service.store.jobs, "save", side_effect=OSError("database error")
            ),
            self.assertRaises(OSError),
        ):
            await self.service.chat.send_message(
                self.conversation["id"],
                "hello",
                "builtin-fake-text",
                8,
                0.5,
                client_request_id="request",
            )
        self.assertEqual(
            self.service.queries.conversation(self.conversation["id"])["messages"], []
        )
        self.assertEqual(self.service.lifecycle.items, {})
        self.assertIsNone(
            self.service.chat.journal.find(self.conversation["id"], "request")
        )

    async def test_retry_reuses_one_job_before_and_after_restart(self):
        first = await self.service.chat.send_message(
            self.conversation["id"],
            "hello",
            "builtin-fake-text",
            8,
            0.5,
            client_request_id="request",
        )
        second = await self.service.chat.send_message(
            self.conversation["id"],
            "hello",
            "builtin-fake-text",
            8,
            0.5,
            client_request_id="request",
        )
        self.assertEqual(first["jobId"], second["jobId"])
        await self.service.scheduler.tasks[first["jobId"]]
        database = self.service.store.database_path
        await self.service.close()
        self.service = create_test_runtime(SQLiteRepositories(database), RUNTIME_SOURCE)
        third = await self.service.chat.send_message(
            self.conversation["id"],
            "hello",
            "builtin-fake-text",
            8,
            0.5,
            client_request_id="request",
        )
        self.assertEqual(third["jobId"], first["jobId"])
        self.assertEqual(len(self.service.queries.list_jobs()), 1)
        self.assertEqual(
            len(self.service.queries.conversation(self.conversation["id"])["messages"]),
            2,
        )

    async def test_completion_failure_keeps_old_assistant_and_rolls_back_new_result(
        self,
    ):
        store = self.service.store
        store.conversations.save_message(
            {
                "id": "user",
                "turnId": "turn",
                "conversationId": self.conversation["id"],
                "role": "user",
                "content": "hello",
            }
        )
        store.conversations.save_message(
            {
                "id": "old",
                "turnId": "turn",
                "conversationId": self.conversation["id"],
                "role": "assistant",
                "content": "keep me",
            }
        )
        update = store.jobs.update

        def fail_completion(job_id, state, error_code=None):
            if state == "succeeded":
                raise OSError("commit failed")
            return update(job_id, state, error_code)

        with patch.object(store.jobs, "update", side_effect=fail_completion):
            result = await self.service.chat.send_message(
                self.conversation["id"],
                "hello",
                "builtin-fake-text",
                8,
                0.5,
                persist_user_message=False,
                turn_id="turn",
                replace_assistant_message_id="old",
            )
            await self.service.scheduler.tasks[result["jobId"]]
        messages = store.conversations.get(self.conversation["id"])["messages"]
        self.assertEqual([item["id"] for item in messages], ["user", "old"])
        self.assertEqual(
            self.service.lifecycle.items[result["jobId"]].state, JobState.FAILED
        )

    async def test_regenerate_keeps_turn_parameters_and_attachments(self):
        self.service.store.attachments.save(
            {
                "id": "attachment",
                "sha256": "digest",
                "mimeType": "image/png",
                "sizeBytes": 8,
                "relativePath": "attachments/attachment",
                "originalName": "image.png",
            }
        )
        self.service.store.conversations.save_message(
            {
                "id": "user",
                "turnId": "turn",
                "conversationId": self.conversation["id"],
                "role": "user",
                "content": "describe",
                "attachmentIds": ["attachment"],
                "parameters": {"maxTokens": 777, "temperature": 1.2},
            }
        )
        self.service.store.conversations.save_message(
            {
                "id": "old",
                "turnId": "turn",
                "conversationId": self.conversation["id"],
                "role": "assistant",
                "content": "old",
            }
        )
        with patch.object(
            self.service.chat, "send_message", new=AsyncMock(return_value={})
        ) as send:
            await self.service.chat.regenerate(self.conversation["id"], "model")
        self.assertEqual(send.call_args.args[3:6], (777, 1.2, ["attachment"]))
        self.assertEqual(send.call_args.kwargs["turn_id"], "turn")
        self.assertEqual(send.call_args.kwargs["replace_assistant_message_id"], "old")

    async def test_removal_reservation_blocks_new_admission(self):
        model = replace(fake_text_manifest(), id="local", source="local")
        self.service.catalog.models[model.id] = model
        async with self.service.scheduler.reserve_removal(model.id):
            with self.assertRaisesRegex(Exception, "移除"):
                await self.service.chat.send_message(
                    self.conversation["id"], "hello", model.id, 8, 0.5
                )
        self.service.scheduler.check_admission(model.id)

    async def test_timeout_finishes_and_releases_worker_before_next_job(self):
        self.service.scheduler.timeout_seconds = 0.02

        async def slow_load(_):
            await asyncio.sleep(1)

        with patch.object(self.service.inference, "load", new=slow_load):
            result = await self.service.chat.send_message(
                self.conversation["id"], "hello", "builtin-fake-text", 8, 0.5
            )
            await self.service.scheduler.tasks[result["jobId"]]
        self.assertEqual(
            self.service.lifecycle.items[result["jobId"]].error_code,
            "INFERENCE_TIMEOUT",
        )
        self.assertFalse(self.service.scheduler.lock.locked())


class EventGapTests(unittest.IsolatedAsyncioTestCase):
    async def test_old_cursor_and_overflow_require_resync(self):
        hub = EventHub()
        for _ in range(1025):
            await hub.publish("test", {})
        queue = await hub.subscribe(1)
        self.assertEqual((await queue.get()).type, "runtime.resync_required")
        hub.unsubscribe(queue)
        queue = await hub.subscribe(hub.sequence)
        for _ in range(513):
            await hub.publish("test", {})
        self.assertEqual((await queue.get()).type, "runtime.resync_required")
        hub.unsubscribe(queue)


class MigrationRecoveryTests(unittest.TestCase):
    def test_legacy_messages_and_model_ids_survive_idempotent_upgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.db"
            store = SQLiteRepositories(path)
            model = replace(
                fake_text_manifest(),
                id="legacy-model",
                source="local",
                local_path="/legacy/model",
            )
            store.models.upsert(model.to_dict())
            store.conversations.save(
                {"id": "legacy", "title": "Keep", "modelId": model.id}
            )
            store.conversations.save_message(
                {
                    "id": "message",
                    "conversationId": "legacy",
                    "role": "user",
                    "content": "keep",
                }
            )
            store.database.connection.execute(
                "ALTER TABLE messages DROP COLUMN turn_id"
            )
            store.database.connection.execute("DROP TABLE chat_submissions")
            store.database.connection.execute(
                "DELETE FROM schema_migrations WHERE version=2"
            )
            store.database.connection.commit()
            store.close()
            for _ in range(2):
                store = SQLiteRepositories(path)
                self.assertEqual(
                    store.conversations.get("legacy")["messages"][0]["content"], "keep"
                )
                self.assertEqual(store.models.list()[0]["id"], "legacy-model")
                store.close()

    def test_orphan_commits_are_quarantined_and_known_files_are_retained(self):
        import uuid

        from mlx_studio_runtime.adapters.media_recovery import recover_media

        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "app.db")
            name = str(uuid.uuid4())
            orphan = store.media_path / "images" / f"{name}.png"
            orphan.parent.mkdir(parents=True)
            orphan.write_bytes(b"interrupted commit")
            self.assertEqual(recover_media(store.database), 1)
            self.assertFalse(orphan.exists())
            recovered = store.media_path / ".recovery" / "images" / orphan.name
            self.assertEqual(recovered.read_bytes(), b"interrupted commit")
            self.assertEqual(recover_media(store.database), 0)
            store.close()


class ImageSubmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_image_response_retry_reuses_one_job_with_a_random_seed(self):
        from mlx_studio_runtime.domain.image_generation import ImageParameters

        with tempfile.TemporaryDirectory() as directory:
            service = create_test_runtime(
                SQLiteRepositories(Path(directory) / "app.db"), RUNTIME_SOURCE
            )
            first_parameters = ImageParameters(
                "builtin-fake-image", "a lake", 512, 512, 20, 42
            )
            second_parameters = ImageParameters(
                "builtin-fake-image", "a lake", 512, 512, 20, 99
            )
            try:
                first = await service.images.create(first_parameters, "request", None)
                second = await service.images.create(second_parameters, "request", None)
                self.assertEqual(first["id"], second["id"])
                self.assertEqual(second["seed"], 42)
                self.assertEqual(len(service.store.images.jobs()), 1)
                await service.scheduler.cancel(first["id"])
            finally:
                await service.close()

    async def test_model_directory_alias_is_protected_by_another_installation_job(self):
        with tempfile.TemporaryDirectory() as directory:
            service = create_test_runtime(
                SQLiteRepositories(Path(directory) / "app.db"), RUNTIME_SOURCE
            )
            first = replace(
                fake_text_manifest(),
                id="first",
                source="local",
                local_path="/same/path",
            )
            second = replace(first, id="second")
            service.catalog.models.update(first=first, second=second)
            from mlx_studio_runtime.domain.jobs import Job

            service.lifecycle._items["reference"] = Job(
                "reference", "chat", JobState.QUEUED, second.id
            )
            try:
                with self.assertRaisesRegex(Exception, "引用"):
                    async with service.scheduler.reserve_removal(first.id):
                        self.fail("Referenced files must not be reserved for deletion")
            finally:
                service.lifecycle._items.clear()
                await service.close()
