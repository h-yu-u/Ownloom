"""Restore ownership is independent of SQLite, the filesystem and the Node transport."""

import asyncio
import unittest
from pathlib import Path

from mlx_studio_runtime.application.restore_profile import (
    RestoreProfile,
    RestoreProfilePorts,
)


class ProfileOwner:
    def __init__(self, events):
        self.events = events
        self.completed = False
        self.target_present = False
        self.upload_present = True
        self.activated = False
        self.prepare_error = None
        self.activate_error = None
        self.target = Path("/unused/target")

    def prepare(self, identifier):
        self.events.append("prepare")
        self.target_present = True
        if self.prepare_error:
            raise self.prepare_error
        return Path("/unused/source"), self.target

    async def prepare_async(self, identifier):
        return self.prepare(identifier)

    def complete(self, target):
        self.events.append("complete?")
        return self.completed

    def activate(self, identifier):
        self.events.append("activate")
        if self.activate_error:
            raise self.activate_error
        if not self.completed:
            raise AssertionError("cannot activate an incomplete profile")
        self.activated = True
        self.discard_upload(identifier)

    def discard(self, identifier):
        self.events.append("discard")
        if not self.completed:
            self.target_present = False

    def discard_upload(self, identifier):
        self.events.append("discard-upload")
        self.upload_present = False


class NodeOwner:
    def __init__(self, profiles, events):
        self.profiles, self.events = profiles, events
        self.started = asyncio.Event()
        self.receipt = asyncio.get_running_loop().create_future()
        self.blocked = False
        self.failure = None
        self.cancelled = False

    async def import_profile(self, identifier):
        self.events.append("node-start")
        self.started.set()
        if not self.blocked:
            self.finish()
        try:
            return await asyncio.shield(self.receipt)
        except asyncio.CancelledError:
            self.cancelled = True
            raise

    def finish(self):
        self.events.append("node-finish")
        if self.failure:
            self.receipt.set_exception(self.failure)
        else:
            self.profiles.completed = True
            self.profiles.target_present = True
            self.receipt.set_result({"imported": True})


class RestoreProfileUseCaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = []
        self.profiles = ProfileOwner(self.events)
        self.node = NodeOwner(self.profiles, self.events)
        self.execute = RestoreProfile(
            RestoreProfilePorts(
                self.profiles.prepare_async,
                self.profiles.complete,
                self.node.import_profile,
                self.profiles.activate,
                self.profiles.discard,
                self.profiles.discard_upload,
            )
        ).execute

    async def asyncTearDown(self):
        if self.node.receipt.done() and not self.node.receipt.cancelled():
            self.node.receipt.exception()

    async def test_prepares_imports_then_activates_in_owner_order(self):
        await self.execute("restore")
        self.assertEqual(
            self.events,
            [
                "prepare",
                "complete?",
                "node-start",
                "node-finish",
                "activate",
                "discard-upload",
            ],
        )
        self.assertTrue(self.profiles.activated)

    async def test_completed_profile_reuses_import_receipt(self):
        self.profiles.completed = True
        self.profiles.upload_present = False
        await self.execute("restore")
        self.assertEqual(
            self.events, ["prepare", "complete?", "activate", "discard-upload"]
        )
        self.assertTrue(self.profiles.activated)

    async def test_prepare_failure_discards_partial_target_and_upload(self):
        self.profiles.prepare_error = OSError("prepare")
        with self.assertRaisesRegex(OSError, "prepare"):
            await self.execute("restore")
        self.assertEqual(self.events, ["prepare", "discard", "discard-upload"])
        self.assertFalse(self.profiles.target_present)
        self.assertFalse(self.profiles.upload_present)

    async def test_node_failure_discards_only_after_owner_finishes(self):
        self.node.failure = OSError("import")
        with self.assertRaisesRegex(OSError, "import"):
            await self.execute("restore")
        self.assertEqual(self.events[-3:], ["node-finish", "discard", "discard-upload"])
        self.assertFalse(self.profiles.activated)
        self.assertFalse(self.profiles.target_present)
        self.assertFalse(self.profiles.upload_present)

    async def test_activation_failure_preserves_complete_profile_for_retry(self):
        self.profiles.activate_error = OSError("activate")
        with self.assertRaisesRegex(OSError, "activate"):
            await self.execute("restore")
        self.assertTrue(self.profiles.target_present)
        self.assertFalse(self.profiles.upload_present)
        self.profiles.activate_error = None
        self.events.clear()
        await self.execute("restore")
        self.assertEqual(
            self.events, ["prepare", "complete?", "activate", "discard-upload"]
        )

    async def cancelled_import(self, failure=None):
        self.node.blocked = True
        self.node.failure = failure
        task = asyncio.create_task(self.execute("restore"))
        await asyncio.wait_for(self.node.started.wait(), 1)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        retained = not task.done()
        events_while_writing = list(self.events)
        self.node.finish()
        result = (await asyncio.gather(task, return_exceptions=True))[0]
        self.assertTrue(
            retained, "restore returned cancellation while Node was still writing"
        )
        self.assertNotIn("discard", events_while_writing)
        self.assertFalse(self.node.cancelled)
        self.assertIsInstance(result, asyncio.CancelledError)
        self.assertFalse(self.profiles.activated)
        self.assertFalse(self.profiles.upload_present)

    async def test_cancel_waits_for_import_without_activating_and_allows_retry(self):
        await self.cancelled_import()
        self.assertTrue(self.profiles.target_present)
        self.events.clear()
        await self.execute("restore")
        self.assertEqual(
            self.events, ["prepare", "complete?", "activate", "discard-upload"]
        )

    async def test_cancelled_failed_import_discards_after_receipt(self):
        await self.cancelled_import(OSError("late import failure"))
        self.assertFalse(self.profiles.target_present)
        self.assertEqual(self.events[-3:], ["node-finish", "discard", "discard-upload"])
