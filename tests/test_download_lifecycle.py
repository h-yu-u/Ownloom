import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from mlx_studio_runtime.adapters.persistence.download_repository import (
    DownloadRepository,
)
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.application.downloads import Downloads


class DownloadLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_pause_waits_for_actual_stop_and_resume_keeps_resolved_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "app.db")
            records = DownloadRepository(store.database)
            started, stopped, release = (
                asyncio.Event(),
                asyncio.Event(),
                asyncio.Event(),
            )
            revisions = []

            async def transfer(repo, revision, update):
                revisions.append(revision)
                update(
                    {
                        "type": "plan",
                        "revision": "fixed-sha",
                        "path": directory,
                        "files": [],
                    }
                )
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    await release.wait()
                    stopped.set()

            service = Downloads(AsyncMock(), AsyncMock(), records, transfer)
            item = service.start("community/model", "main")
            await started.wait()
            pause = asyncio.create_task(service.stop(item["id"]))
            await asyncio.sleep(0)
            self.assertFalse(pause.done())
            self.assertNotEqual(records.get(item["id"])["state"], "paused")
            release.set()
            self.assertEqual((await pause)["state"], "paused")
            self.assertTrue(stopped.is_set())
            started.clear()
            service.resume(item["id"])
            await started.wait()
            self.assertEqual(revisions, ["main", "fixed-sha"])
            await service.close()
            records.save({**records.get(item["id"]), "state": "downloading"})
            self.assertEqual(
                DownloadRepository(store.database).get(item["id"])["state"], "paused"
            )
            store.close()

    async def test_immediate_cancel_before_runner_starts_settles(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SQLiteRepositories(Path(directory) / "app.db")
            records = DownloadRepository(store.database)
            transfer = AsyncMock()
            service = Downloads(AsyncMock(), AsyncMock(), records, transfer)
            item = service.start("community/model")
            self.assertEqual(
                (await service.stop(item["id"], cancel=True))["state"], "cancelled"
            )
            transfer.assert_not_called()
            await service.close()
            store.close()
