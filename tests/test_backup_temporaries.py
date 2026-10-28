"""Temporary snapshots and failed restore uploads have explicit disposal owners."""

import asyncio
import io
import json
import os
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from zipfile import ZipFile

import httpx
from mlx_studio_runtime.adapters.temporary_data import (
    discard_temporary,
    prune_temporaries,
)
from runtime_fixtures import create_test_app


class BackupTemporaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.app = create_test_app("test", self.root / "data" / "app.db")
        self.service = self.app.state.service
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app),
            base_url="http://fixture",
            headers={"Authorization": "Bearer test"},
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.service.close()
        self.temporary.cleanup()

    def assert_no_exports(self):
        for directory in (
            self.root / "data" / "exports",
            self.root / "data" / "coding" / "exports",
        ):
            self.assertEqual(list(directory.glob("*")), [], str(directory))

    async def test_download_releases_both_owner_snapshots(self):
        response = await self.client.post("/internal/v1/storage/backup")
        self.assertEqual(response.status_code, 200)
        with ZipFile(io.BytesIO(response.content)) as archive:
            self.assertIn("runtime.db", archive.namelist())
        self.assert_no_exports()

    async def test_failed_integrity_preview_removes_extracted_files(self):
        response = await self.client.post("/internal/v1/storage/backup")
        corrupt = io.BytesIO()
        with (
            ZipFile(io.BytesIO(response.content)) as incoming,
            ZipFile(corrupt, "w") as outgoing,
        ):
            for name in incoming.namelist():
                content = incoming.read(name)
                if name == "manifest.json":
                    manifest = json.loads(content)
                    manifest["files"][0]["sha256"] = "0" * 64
                    content = json.dumps(manifest).encode()
                outgoing.writestr(name, content)
        failed = await self.client.post(
            "/internal/v1/storage/restore/preview", content=corrupt.getvalue()
        )
        self.assertEqual(failed.json()["error"]["code"], "BACKUP_HASH_MISMATCH")
        self.assertEqual(list((self.root / ".restore").glob("*")), [])

    async def test_activation_releases_preview_and_remains_idempotent(self):
        backup = await self.client.post("/internal/v1/storage/backup")
        preview = await self.client.post(
            "/internal/v1/storage/restore/preview", content=backup.content
        )
        identifier = preview.json()["id"]
        for _ in range(2):
            response = await self.client.post(
                f"/internal/v1/storage/restore/{identifier}/activate"
            )
            self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse((self.root / ".restore" / identifier).exists())
        self.assertTrue(
            (self.root / "profiles" / identifier / "data" / "app.db").is_file()
        )

    async def test_disconnected_download_releases_snapshot(self):
        route = next(
            route
            for route in self.app.routes
            if getattr(route, "path", "") == "/internal/v1/storage/backup"
        )
        response = await route.endpoint()

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def disconnected(message):
            if message["type"] == "http.response.body":
                raise ConnectionError("isolated disconnected receiver")

        with self.assertRaises(ConnectionError):
            await response(
                {"type": "http", "method": "POST", "headers": []}, receive, disconnected
            )
        self.assert_no_exports()

    async def test_cancelled_build_waits_for_thread_then_removes_both_snapshots(self):
        entered, release = threading.Event(), threading.Event()
        original = self.service.storage.backup

        def blocked(path):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test did not release snapshot builder")
            original(path)

        self.service.storage.backup = blocked
        building = asyncio.create_task(self.service.data.backup())
        try:
            async with asyncio.timeout(5):
                while not entered.is_set():
                    await asyncio.sleep(0.001)
            building.cancel()
            await asyncio.sleep(0)
            building.cancel()
            await asyncio.sleep(0)
            self.assertFalse(building.done())
            self.assertTrue(self.service.data.busy)
        finally:
            release.set()
        with self.assertRaises(asyncio.CancelledError):
            await building
        self.assert_no_exports()
        self.assertFalse(self.service.data.busy)

    async def test_failed_runtime_snapshot_releases_both_owner_directories(self):
        def failed(_):
            raise OSError("isolated database backup failure")

        self.service.storage.backup = failed
        with self.assertRaises(OSError):
            await self.service.data.backup()
        self.assert_no_exports()

    async def test_discard_preview_is_idempotent_and_does_not_touch_profiles(self):
        identifier, incoming = self.service.profiles.upload_path()
        incoming.write_bytes(b"temporary upload")
        profile = self.root / "profiles" / identifier / "preserve.txt"
        profile.parent.mkdir(parents=True)
        profile.write_text("existing profile")
        for _ in range(2):
            response = await self.client.delete(
                f"/internal/v1/storage/restore/{identifier}"
            )
            self.assertEqual(response.status_code, 200)
        self.assertFalse(incoming.parent.exists())
        self.assertEqual(profile.read_text(), "existing profile")

    async def test_cancelled_validation_waits_for_extraction_before_disposal(self):
        backup = await self.client.post("/internal/v1/storage/backup")
        identifier, incoming = self.service.profiles.upload_path()
        incoming.write_bytes(backup.content)
        entered, release = threading.Event(), threading.Event()
        original = self.service.profiles._validate

        def blocked(value):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test did not release archive validator")
            return original(value)

        self.service.profiles._validate = blocked
        checking = asyncio.create_task(self.service.profiles.inspect(identifier))
        try:
            async with asyncio.timeout(5):
                while not entered.is_set():
                    await asyncio.sleep(0.001)
            checking.cancel()
            await asyncio.sleep(0)
            checking.cancel()
            await asyncio.sleep(0)
            self.assertFalse(checking.done())
        finally:
            release.set()
        with self.assertRaises(asyncio.CancelledError):
            await checking
        self.assertFalse(incoming.parent.exists())


class TemporaryOwnershipTests(unittest.TestCase):
    def test_expiry_only_removes_owned_inactive_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expired, active, fresh = [root / str(uuid.uuid4()) for _ in range(3)]
            unmanaged = root / "user-export"
            for path in (expired, active, fresh, unmanaged):
                path.mkdir()
                (path / "keep.txt").write_text("owned fixture")
            for path in (expired, active, unmanaged):
                os.utime(path, (1, 1))
            prune_temporaries(root, {active.name})
            self.assertFalse(expired.exists())
            self.assertTrue(active.exists())
            self.assertTrue(fresh.exists())
            self.assertTrue(unmanaged.exists())
            with self.assertRaises(ValueError):
                discard_temporary(root, unmanaged)
            with self.assertRaises(ValueError):
                discard_temporary(fresh, active)
