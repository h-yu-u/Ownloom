"""Backup closes mutation admission and drains already accepted HTTP work."""

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
from mlx_studio_runtime.application.data_admission import DataAdmission
from mlx_studio_runtime.domain.errors import RuntimeFault
from runtime_fixtures import create_test_app


class BackupAdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_backup_releases_only_its_own_barrier(self):
        admission = DataAdmission()
        release = admission.enter()

        async def snapshot():
            async with admission.exclusive():
                self.fail("Snapshot started before the pending write settled")

        task = asyncio.create_task(snapshot())
        await asyncio.sleep(0)
        with self.assertRaises(RuntimeFault):
            async with admission.exclusive():
                pass
        self.assertTrue(admission.closed)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertFalse(admission.closed)
        admission.enter()()
        release()
        release()
        async with admission.exclusive():
            pass

    async def test_backup_waits_for_existing_request_and_rejects_later_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = create_test_app("fixture", root / "data" / "app.db")
            service = app.state.service
            entered, release = asyncio.Event(), asyncio.Event()
            snapshot_started = False
            destination = root / "snapshot.zip"
            destination.write_bytes(b"isolated snapshot")

            @app.post("/review/mutation")
            async def mutation():
                entered.set()
                await release.wait()
                service.store.conversations.save(
                    {"id": "late", "title": "accepted write"}
                )
                return {"saved": True}

            async def export(_):
                nonlocal snapshot_started
                snapshot_started = True
                self.assertEqual(
                    service.queries.conversation("late")["title"], "accepted write"
                )
                return destination

            service.coding.call = AsyncMock(return_value={"directory": str(root)})
            service.data.export = export
            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://fixture",
                    headers={"Authorization": "Bearer fixture"},
                ) as client:
                    writing = asyncio.create_task(client.post("/review/mutation"))
                    await entered.wait()
                    backup = asyncio.create_task(
                        client.post("/internal/v1/storage/backup")
                    )
                    try:
                        async with asyncio.timeout(2):
                            while not service.data.busy and not backup.done():
                                await asyncio.sleep(0.001)
                        self.assertFalse(snapshot_started)
                        denied = await client.post("/review/mutation")
                        self.assertEqual(denied.status_code, 409)
                        self.assertEqual(
                            denied.json()["error"]["code"], "BACKUP_IN_PROGRESS"
                        )
                    finally:
                        release.set()
                        await writing
                        result = await asyncio.gather(backup, return_exceptions=True)
                    self.assertIsInstance(result[0], httpx.Response)
                    self.assertEqual(result[0].status_code, 200)
                    self.assertFalse(service.data.busy)
            finally:
                await service.close()
