"""Application contract checks with in-memory ports, without SQLite or subprocesses."""

import unittest
from contextlib import asynccontextmanager
from dataclasses import replace

from mlx_studio_runtime.application.model_removal import ModelRemovalPorts, RemoveModel
from mlx_studio_runtime.domain.errors import RuntimeFault
from mlx_studio_runtime.domain.models import ModelManifest, fake_text_manifest


class FakeModelFiles:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls
        self.failure: OSError | None = None

    def validate(self, model: ModelManifest) -> None:
        self.calls.append("validate")

    async def delete(self, model: ModelManifest) -> None:
        self.calls.append("delete")
        if self.failure:
            raise self.failure


class ModelRemovalPortTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.calls: list[str] = []
        self.model = replace(fake_text_manifest(), source="huggingface")
        self.registered = True
        self.shared = False
        self.unload_failure: OSError | None = None
        self.files = FakeModelFiles(self.calls)
        self.use_case = RemoveModel(
            ModelRemovalPorts(
                find=lambda _: self.model if self.registered else None,
                remove=self.remove,
                reserve=self.reserve,
                unload=self.unload,
                shared_path=lambda _: self.shared,
            ),
            self.files,
        )

    @asynccontextmanager
    async def reserve(self, model_id: str):
        self.calls.append("reserve")
        try:
            yield
        finally:
            self.calls.append("release")

    async def unload(self, model_id: str) -> None:
        self.calls.append("unload")
        if self.unload_failure:
            raise self.unload_failure

    def remove(self, model_id: str) -> None:
        self.calls.append("unregister")
        self.registered = False

    async def test_files_are_deleted_only_inside_lease_after_unload(self) -> None:
        result = await self.use_case.execute(self.model.id, delete_files=True)
        self.assertEqual(result, {"removed": True})
        self.assertEqual(
            self.calls,
            ["reserve", "validate", "unload", "delete", "unregister", "release"],
        )

    async def test_registration_removal_never_calls_file_port(self) -> None:
        await self.use_case.execute(self.model.id)
        self.assertEqual(self.calls, ["reserve", "unload", "unregister", "release"])

    async def test_unload_and_file_failures_preserve_registration_and_release(
        self,
    ) -> None:
        for failure in ("unload", "delete"):
            with self.subTest(failure=failure):
                self.calls.clear()
                self.unload_failure = (
                    OSError("unavailable") if failure == "unload" else None
                )
                self.files.failure = (
                    OSError("unavailable") if failure == "delete" else None
                )
                with self.assertRaises(RuntimeFault) as caught:
                    await self.use_case.execute(self.model.id, delete_files=True)
                self.assertEqual(caught.exception.info.code, "MODEL_REMOVAL_FAILED")
                self.assertTrue(self.registered)
                self.assertNotIn("unregister", self.calls)
                self.assertEqual(self.calls[-1], "release")

    async def test_duplicate_path_rejects_before_resource_and_file_changes(
        self,
    ) -> None:
        self.shared = True
        with self.assertRaises(RuntimeFault) as caught:
            await self.use_case.execute(self.model.id, delete_files=True)
        self.assertEqual(caught.exception.info.code, "MODEL_IN_USE")
        self.assertEqual(self.calls, ["reserve", "release"])
