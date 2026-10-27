"""Owner snapshots, manifest integrity, isolated restore and reversible activation."""

import shutil
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from mlx_studio_runtime.adapters.data_profiles import resolve_profile
from mlx_studio_runtime.domain.errors import RuntimeFault
from runtime_fixtures import create_test_app


class DataRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "data" / "app.db"
        self.service = create_test_app("test", self.database).state.service

    async def asyncTearDown(self):
        await self.service.close()
        self.temporary.cleanup()

    async def test_owner_backup_restores_separate_profile_and_can_rollback(self):
        conversation = {"id": "backup-conversation", "title": "backup fixture"}
        self.service.store.conversations.save(conversation)
        await self.service.coding.call("settings.get", {})
        backup = await self.service.data.backup()
        identifier, incoming = self.service.profiles.upload_path()
        shutil.copyfile(backup, incoming)
        preview = self.service.profiles.validate(identifier)
        self.assertTrue(preview["requiresRestart"])
        self.assertGreaterEqual(preview["files"], 5)
        await self.service.data.restore_profile(identifier)
        await self.service.data.restore_profile(identifier)
        restored = resolve_profile(self.database)
        self.assertNotEqual(restored, self.database)
        self.assertTrue(self.database.is_file())
        app = create_test_app("test", restored)
        try:
            self.assertEqual(
                app.state.service.queries.conversation(conversation["id"])["title"],
                "backup fixture",
            )
            self.assertTrue(await app.state.service.coding.call("settings.get", {}))
        finally:
            await app.state.service.close()
        self.service.profiles.rollback()
        self.assertEqual(resolve_profile(self.database), self.database)

    async def test_corrupt_manifest_and_zip_traversal_never_activate(self):
        identifier, incoming = self.service.profiles.upload_path()
        with ZipFile(incoming, "w") as archive:
            archive.writestr("manifest.json", '{"version": 1, "files": []}')
            archive.writestr("../escape", "invalid")
        with self.assertRaises(RuntimeFault):
            self.service.profiles.validate(identifier)
        self.assertEqual(resolve_profile(self.database), self.database)
        self.assertFalse((Path(self.temporary.name) / "escape").exists())
