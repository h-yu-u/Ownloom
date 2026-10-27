import asyncio
import unittest
from unittest.mock import AsyncMock, Mock

from mlx_studio_runtime.application.model_runtime import ModelRuntime
from mlx_studio_runtime.domain.models import fake_text_manifest
from mlx_studio_runtime.domain.runtime_state import RuntimeState


class LoadCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_load_reaps_worker_and_restores_available_model(self):
        started = asyncio.Event()

        async def load(_manifest):
            started.set()
            await asyncio.Event().wait()

        worker = Mock(load=AsyncMock(side_effect=load), stop=AsyncMock())
        repository, events = Mock(), AsyncMock()
        model = fake_text_manifest()
        runtime = ModelRuntime({model.id: model}, repository, events, lambda: worker)
        loading = asyncio.create_task(runtime.load(model.id))
        await started.wait()
        self.assertEqual(runtime.loading_model_id, model.id)
        loading.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await loading
        worker.stop.assert_awaited()
        self.assertIsNone(runtime.worker)
        self.assertIsNone(runtime.loading_model_id)
        self.assertEqual(runtime.state, RuntimeState.READY)
        repository.update_state.assert_called_with(model.id, "available")

    async def test_old_worker_cleanup_cannot_clear_replacement(self):
        model = fake_text_manifest()
        old = Mock(stop=AsyncMock())
        replacement = Mock(stop=AsyncMock())
        runtime = ModelRuntime(
            {model.id: model}, Mock(), AsyncMock(), lambda: replacement
        )
        runtime.worker, runtime.active_model_id = replacement, model.id
        await runtime.stop(old)
        self.assertIs(runtime.worker, replacement)
        self.assertEqual(runtime.active_model_id, model.id)
        replacement.stop.assert_not_called()
