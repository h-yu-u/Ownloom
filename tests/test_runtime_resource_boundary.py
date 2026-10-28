import asyncio
import unittest
from contextlib import nullcontext
from unittest.mock import AsyncMock, Mock

from mlx_studio_runtime.application.job_lifecycle import JobLifecycle
from mlx_studio_runtime.application.job_scheduler import JobScheduler
from mlx_studio_runtime.application.model_runtime import ModelRuntime
from mlx_studio_runtime.application.runtime_control import RuntimeControl
from mlx_studio_runtime.domain.errors import RuntimeFault
from mlx_studio_runtime.domain.jobs import Job, JobState
from mlx_studio_runtime.domain.models import fake_text_manifest


class RuntimeResourceBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.model = fake_text_manifest()
        self.worker = Mock(load=AsyncMock(), stop=AsyncMock())
        self.runtime = ModelRuntime(
            {self.model.id: self.model}, Mock(), AsyncMock(), lambda: self.worker
        )
        self.runtime.worker = self.worker
        self.runtime.active_model_id = self.model.id
        self.runtime.phase = "ready"
        lifecycle = JobLifecycle(Mock(), AsyncMock(), nullcontext)
        self.scheduler = JobScheduler(lifecycle, self.runtime)
        self.controls = RuntimeControl(self.scheduler, self.runtime)

    async def fail_unload(self):
        self.worker.stop.side_effect = OSError("injected stop failure")
        with self.assertRaises(OSError):
            await self.controls.unload(self.model.id)

    async def test_explicit_unload_failure_closes_new_admission(self):
        await self.fail_unload()
        with self.assertRaises(RuntimeFault) as caught:
            self.scheduler.check_admission(self.model.id)
        self.assertEqual(caught.exception.info.code, "RUNTIME_RESOURCES_NOT_AVAILABLE")

    async def test_failed_worker_is_not_reported_loaded_by_the_fast_path(self):
        await self.fail_unload()
        with self.assertRaises(RuntimeFault) as caught:
            await self.controls.load(self.model.id)
        self.assertEqual(caught.exception.info.code, "RUNTIME_RESOURCES_NOT_AVAILABLE")
        self.worker.load.assert_not_awaited()

    async def test_queued_job_cannot_execute_after_explicit_unload_fails(self):
        self.worker.stop.side_effect = OSError("injected stop failure")
        job = Job("queued", "test", JobState.QUEUED, self.model.id)
        await self.scheduler.lifecycle.register(job, {})
        execute = AsyncMock()
        await self.scheduler.lock.acquire()
        unload = asyncio.create_task(self.controls.unload(self.model.id))
        await asyncio.sleep(0)
        task = self.scheduler.schedule(job, execute)
        self.scheduler.lock.release()
        with self.assertRaises(OSError):
            await unload
        await task
        execute.assert_not_awaited()
        self.assertEqual(
            self.scheduler.lifecycle.get(job.id).error_code,
            "RUNTIME_RESOURCES_NOT_AVAILABLE",
        )

    async def test_successful_explicit_restart_reopens_admission(self):
        await self.fail_unload()
        self.worker.stop.side_effect = None
        await self.controls.restart()
        self.scheduler.check_admission(self.model.id)
        self.assertEqual(
            await self.controls.load(self.model.id),
            {"modelId": self.model.id, "state": "loaded"},
        )
        self.worker.load.assert_awaited_once()

    async def test_failed_load_with_successful_cleanup_allows_a_later_retry(self):
        await self.controls.unload()
        self.worker.load.side_effect = ValueError("MODEL_LOAD_FAILED")
        with self.assertRaises(RuntimeFault):
            await self.controls.load(self.model.id)
        self.scheduler.check_admission(self.model.id)
        self.worker.load.side_effect = None
        await self.controls.load(self.model.id)
        self.assertEqual(self.runtime.phase, "ready")
