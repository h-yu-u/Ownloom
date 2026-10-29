"""Model settings cannot invalidate prepared or active parent-run identities."""

import asyncio
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.drafts import DraftSettings
from mlx_studio_runtime.domain.errors import RuntimeFault
from runtime_fixtures import create_test_runtime

ROOT = Path(__file__).parents[1]


class DraftRunLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        store = SQLiteRepositories(Path(self.temp.name) / "app.db")
        self.service = create_test_runtime(store, ROOT / "services/runtime/src")
        self.grants = self.service.capability_grants
        self.service.extensions.validate_text = AsyncMock()
        self.grants.generation = lambda: "test-host"
        self.model = replace(
            self.service.catalog.models["builtin-fake-text"], draft=DraftSettings()
        )
        self.service.catalog.models[self.model.id] = self.model
        store.models.upsert(self.model.to_dict(), "loaded")
        self.service.inference.active_model_id = self.model.id
        self.service.inference.stop = AsyncMock()
        self.tasks = []
        self.releases = []

    async def asyncTearDown(self):
        for release in self.releases:
            release.set()
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.service.close()
        self.temp.cleanup()

    def run_input(self, identifier="run-one", workspace="coding"):
        return {
            "id": identifier,
            "sessionId": "session-one",
            "modelId": self.model.id,
            "status": "starting",
            "capabilitySnapshot": {
                "snapshotDigest": "snapshot",
                "workspace": workspace,
                "mode": "develop",
                "skills": [],
                "servers": [],
                "tools": [],
            },
        }

    def start(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.append(task)
        return task

    def barrier(self):
        release = asyncio.Event()
        self.releases.append(release)
        return asyncio.Event(), release

    async def configure(self, legacy=False):
        if legacy:
            return await self.service.acceleration.configure(self.model.id, None)
        return await self.service.acceleration.configure_draft(
            self.model.id, DraftSettings(mode="mtp", mtp_path="/synthetic-draft")
        )

    async def assert_busy(self, action):
        with self.assertRaises(RuntimeFault) as rejected:
            await asyncio.wait_for(action, 1)
        self.assertEqual(rejected.exception.info.code, "MODEL_IN_USE")

    def assert_unchanged(self):
        self.assertEqual(self.service.catalog.models[self.model.id], self.model)
        persisted = self.service.catalog.repository.list()[0]
        self.assertEqual(persisted["draft"], self.model.draft.to_dict())
        self.assertEqual(persisted["state"], "loaded")
        self.service.inference.stop.assert_not_awaited()

    async def test_queued_and_active_coding_and_agent_runs_reject_both_settings_routes(
        self,
    ):
        for workspace in ("coding", "chat"):
            run = self.run_input(workspace, workspace)
            bootstrap = await self.grants.prepare(run)
            for active in (False, True):
                if active:
                    await self.grants.activate(bootstrap)
                for legacy in (False, True):
                    await self.assert_busy(self.configure(legacy))
                    self.assert_unchanged()
            await self.grants.cancel_id(run["id"])
        await self.configure()
        self.service.inference.stop.assert_awaited_once()

    async def test_preparing_host_request_protects_model_before_a_grant_exists(self):
        entered, release = self.barrier()
        run = self.run_input()

        async def prepare(*_):
            entered.set()
            await release.wait()
            return run

        self.service.coding_requests.call = AsyncMock(side_effect=prepare)
        self.service.extensions.coding.call = AsyncMock(return_value=run)
        submitted = self.start(
            self.service.coding_submissions.submit(
                {}, "http://127.0.0.1:1234", self.model.id
            )
        )
        await asyncio.wait_for(entered.wait(), 1)
        self.assertFalse(self.grants.grants)
        await self.assert_busy(self.configure())
        self.assert_unchanged()
        release.set()
        await submitted
        await self.assert_busy(self.configure())
        await self.grants.cancel_id(run["id"])
        await self.configure()

    async def test_async_capability_validation_reserves_the_model(self):
        entered, release = self.barrier()

        async def validate(_):
            entered.set()
            await release.wait()

        self.service.extensions.validate_text.side_effect = validate
        prepared = self.start(self.grants.prepare(self.run_input()))
        await asyncio.wait_for(entered.wait(), 1)
        await self.assert_busy(self.configure())
        self.assert_unchanged()
        release.set()
        await prepared

    async def test_shutdown_rejects_pending_and_new_preparation_without_retaining_a_grant(
        self,
    ):
        entered, release = self.barrier()

        async def validate(_):
            entered.set()
            await release.wait()

        self.service.extensions.validate_text.side_effect = validate
        prepared = self.start(self.grants.prepare(self.run_input()))
        await asyncio.wait_for(entered.wait(), 1)
        await asyncio.wait_for(self.grants.close(), 1)
        release.set()
        with self.assertRaises(RuntimeFault) as rejected:
            await prepared
        self.assertEqual(rejected.exception.info.code, "CAPABILITY_REVOKED")
        with self.assertRaises(RuntimeFault) as rejected:
            await self.grants.prepare(self.run_input("after-close"))
        self.assertEqual(rejected.exception.info.code, "CAPABILITY_REVOKED")
        self.service.extensions.validate_text.assert_awaited_once()
        self.assertFalse(self.grants.grants)
        self.assertFalse(self.grants.pending)
        self.assertFalse(self.grants.tokens)
        self.assertIsNone(self.grants.reaper)
        self.assertIsNone(self.grants.ledger.scope("run-one"))
        self.assertIsNone(self.grants.ledger.scope("after-close"))
        await self.configure()

    async def test_model_change_rejects_new_grants_and_host_preparation_until_committed(
        self,
    ):
        stopped, release = self.barrier()

        async def stop(*_):
            stopped.set()
            await release.wait()

        self.service.inference.stop.side_effect = stop
        self.service.coding_requests.call = AsyncMock(return_value=self.run_input())
        changing = self.start(self.configure())
        await asyncio.wait_for(stopped.wait(), 1)
        await self.assert_busy(self.grants.prepare(self.run_input()))
        await self.assert_busy(
            self.service.coding_submissions.submit(
                {}, "http://127.0.0.1:1234", self.model.id
            )
        )
        self.service.coding_requests.call.assert_not_awaited()
        self.assertIsNone(self.grants.ledger.scope("run-one"))
        release.set()
        await changing
        bootstrap = await self.grants.prepare(self.run_input())
        await self.grants.activate(bootstrap)

    async def test_change_reservation_is_kept_while_waiting_for_an_inference_lease(
        self,
    ):
        await self.service.scheduler.lock.acquire()
        try:
            changing = self.start(self.configure())
            await asyncio.sleep(0)
            self.service.inference.stop.assert_not_awaited()
            await self.assert_busy(self.grants.prepare(self.run_input()))
        finally:
            self.service.scheduler.lock.release()
        await changing

    async def test_failed_or_cancelled_preparation_releases_only_its_transient_reference(
        self,
    ):
        for cancelled in (False, True):
            entered = asyncio.Event()

            async def validate(_, entered=entered, cancelled=cancelled):
                entered.set()
                if cancelled:
                    await asyncio.Future()
                raise ValueError("validation failed")

            self.service.extensions.validate_text.side_effect = validate
            task = self.start(self.grants.prepare(self.run_input()))
            await asyncio.wait_for(entered.wait(), 1)
            if cancelled:
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self.assertFalse(self.grants.grants)
            await self.configure()

    async def test_failed_release_preserves_settings_and_unblocks_future_admission(
        self,
    ):
        self.service.inference.stop.side_effect = RuntimeError("release failed")
        with self.assertRaisesRegex(RuntimeError, "release failed"):
            await self.configure()
        self.assertEqual(self.service.catalog.models[self.model.id], self.model)
        self.assertEqual(
            self.service.catalog.repository.list()[0]["draft"],
            self.model.draft.to_dict(),
        )
        self.service.inference.stop.side_effect = None
        bootstrap = await self.grants.prepare(self.run_input())
        await self.grants.activate(bootstrap)

    async def test_unchanged_settings_still_reload_when_no_parent_run_uses_the_model(
        self,
    ):
        await self.service.acceleration.configure_draft(self.model.id, self.model.draft)
        self.service.inference.stop.assert_awaited_once()
        bootstrap = await self.grants.prepare(self.run_input())
        await self.grants.activate(bootstrap)
        await self.assert_busy(
            self.service.acceleration.configure_draft(self.model.id, self.model.draft)
        )
        self.service.inference.stop.assert_awaited_once()

    async def test_child_admission_and_tool_wait_keep_parent_reference(self):
        run = self.run_input()
        run["capabilitySnapshot"].update(
            tools=[
                {
                    "serverId": "builtin",
                    "originalName": "image_generate",
                    "modelName": "image_generate",
                }
            ],
            mediaBindings={"imageModelId": "builtin-fake-image"},
        )
        bootstrap = await self.grants.prepare(run)
        active = await self.grants.activate(bootstrap)
        token = "Bearer " + active["token"]
        entered, release = self.barrier()

        async def admit(*_):
            entered.set()
            await release.wait()
            return "prepared"

        self.grants.inference.admit = AsyncMock(side_effect=admit)
        self.grants.inference.wait = AsyncMock(return_value={})
        pending = self.start(
            self.grants.complete(token, {"model": self.model.id, "tools": []})
        )
        await asyncio.wait_for(entered.wait(), 1)
        await self.assert_busy(self.configure())
        self.assert_unchanged()
        release.set()
        await pending

        entered, release = self.barrier()
        self.grants.bridge.plan = Mock(return_value={})
        self.grants.bridge.recover = Mock(return_value=None)
        self.grants.bridge.create = AsyncMock(return_value="child-job")
        self.grants.bridge.wait = AsyncMock(side_effect=admit)
        self.service.scheduler.cancel = AsyncMock()
        pending = self.start(
            self.grants.invoke(token, "image-call", "image_generate", {})
        )
        await asyncio.wait_for(entered.wait(), 1)
        self.assertFalse(self.service.scheduler.lock.locked())
        await self.assert_busy(self.configure())
        self.assert_unchanged()
        release.set()
        await pending

    async def test_parent_close_holds_reference_until_child_cleanup_finishes(self):
        run = self.run_input()
        await self.grants.prepare(run)
        self.grants.ledger.reserve(run["id"], "text-one", "inference", "text", {})
        self.grants.ledger.bind(run["id"], "text-one", "child-job")
        entered, release = self.barrier()

        async def cancel(_):
            entered.set()
            await release.wait()

        self.service.scheduler.cancel = AsyncMock(side_effect=cancel)
        closing = self.start(self.grants.cancel_id(run["id"]))
        await asyncio.wait_for(entered.wait(), 1)
        await self.assert_busy(self.configure())
        self.assert_unchanged()
        release.set()
        await closing
        await self.configure()
