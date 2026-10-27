"""Public model and Worker control through the scheduler's resource lease."""

import asyncio
from typing import Any

from mlx_studio_runtime.application.job_scheduler import JobScheduler
from mlx_studio_runtime.application.model_runtime import ModelRuntime
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.runtime_state import RuntimeState


class RuntimeControl:
    def __init__(self, scheduler: JobScheduler, inference: ModelRuntime) -> None:
        self.scheduler = scheduler
        self.inference = inference
        self.restart_lock = asyncio.Lock()

    async def load(self, model_id: str) -> dict[str, Any]:
        self.scheduler.check_model_available(model_id)
        async with self.scheduler.lock:
            self.scheduler.check_model_available(model_id)
            return await self.inference.load(model_id)

    async def unload(self, model_id: str | None = None) -> dict[str, str]:
        async with self.scheduler.lock:
            if model_id is not None and self.inference.active_model_id != model_id:
                raise RuntimeFault(RuntimeErrorInfo("MODEL_NOT_LOADED", "此模型当前未加载"))
            await self.inference.stop()
        return {"state": "available"}

    async def unload_reserved(self, model_id: str) -> None:
        if self.inference.active_model_id == model_id:
            await self.inference.stop()

    async def restart(self, mode: str = "interrupt") -> dict[str, str]:
        async with self.restart_lock:
            self.scheduler.poisoned = True
            model = self.inference.active_model_id
            try:
                if mode == "interrupt":
                    tasks = tuple(self.scheduler.tasks.values())
                    for task in tasks:
                        task.cancel()
                    # The control path does not wait behind the inference lease.
                    await asyncio.wait_for(self.inference.stop(), timeout=10)
                    if tasks:
                        await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 10)
                async with self.scheduler.lock:
                    await self.inference.stop()
                    self.inference.worker_restarts += 1
                    if model:
                        await asyncio.wait_for(self.inference.load(model), timeout=120)
                    self.inference.state = RuntimeState.READY
                    self.scheduler.poisoned = False
            except BaseException:
                self.inference.state = RuntimeState.DEGRADED
                raise
        return {"state": "ready"}
