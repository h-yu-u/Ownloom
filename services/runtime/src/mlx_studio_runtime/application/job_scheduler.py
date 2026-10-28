"""Serial inference leases, bounded admission, cancellation and terminal convergence."""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import TypeVar

from mlx_studio_runtime.application.job_lifecycle import JobLifecycle
from mlx_studio_runtime.application.model_runtime import ModelRuntime
from mlx_studio_runtime.domain.errors import ContextRebuildRequired, RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.jobs import Job, JobEvent, JobState, terminal_state

LOGGER = logging.getLogger("mlx_studio.scheduler")
T = TypeVar("T")
R = TypeVar("R")


class JobScheduler:
    def __init__(self, lifecycle: JobLifecycle, runtime: ModelRuntime) -> None:
        self.lifecycle = lifecycle
        self.runtime = runtime
        self.lock = asyncio.Lock()
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.active_job_id: str | None = None
        self.removing: set[str] = set()
        self.removing_paths: set[str] = set()
        self.queue_limit = 32
        self.timeout_seconds = 3600
        self.poisoned = False

    def check_resources_available(self) -> None:
        self.runtime.check_resources_available()
        if self.poisoned:
            raise RuntimeFault(
                RuntimeErrorInfo(
                    "RUNTIME_RESOURCES_NOT_AVAILABLE", "Worker 资源释放失败，请重启", True
                )
            )

    def check_admission(self, model_id: str) -> None:
        self.check_resources_available()
        self.check_model_available(model_id)
        if (
            sum(not terminal_state(job.state) for job in self.lifecycle.items.values())
            >= self.queue_limit
        ):
            raise RuntimeFault(RuntimeErrorInfo("JOB_QUEUE_FULL", "任务队列已满", True))

    def check_model_available(self, model_id: str, path: str | None = None) -> None:
        model = self.runtime.models.get(model_id)
        path = path or (model.local_path if model else None)
        if model_id in self.removing or (path is not None and path in self.removing_paths):
            raise RuntimeFault(RuntimeErrorInfo("MODEL_IN_USE", "模型正在移除", True))

    def schedule(self, job: Job, execute: Callable[[], Awaitable[None]]) -> asyncio.Task[None]:
        task = asyncio.create_task(self._run(job, execute))
        self.tasks[job.id] = task
        task.add_done_callback(lambda done: self._forget(job.id, done))
        return task

    async def _run(self, job: Job, execute: Callable[[], Awaitable[None]]) -> None:
        try:
            async with self.lock:
                self.check_resources_available()
                if self.lifecycle.items[job.id].state is JobState.CANCELLING:
                    await self.lifecycle.finish(job.id, JobEvent.CANCEL_COMPLETE)
                    return
                self.active_job_id = job.id
                worker = self.runtime.worker
                try:
                    async with asyncio.timeout(self.timeout_seconds):
                        await self.lifecycle.transition(job.id, JobEvent.PREPARE)
                        await self.runtime.load(job.model_id or "")
                        worker = self.runtime.worker
                        await execute()
                except BaseException:
                    try:
                        await self.runtime.stop(worker)
                    except Exception:
                        self.poisoned = True
                        raise
                    raise
                finally:
                    self.active_job_id = None
        except asyncio.CancelledError:
            await self.lifecycle.finish_failed_or_cancelled(job.id, "RUNTIME_SHUTDOWN")
            raise
        except TimeoutError:
            await self.lifecycle.finish_failed_or_cancelled(job.id, "INFERENCE_TIMEOUT")
        except RuntimeFault as error:
            await self.lifecycle.finish_failed_or_cancelled(job.id, error.info.code)
        except Exception as error:  # Task boundary: all transport failures converge here.
            LOGGER.exception("Job failed", extra={"job_id": job.id})
            code = getattr(error, "code", "INFERENCE_FAILED")
            await self.lifecycle.finish_failed_or_cancelled(job.id, str(code))

    async def cancel(self, job_id: str) -> dict[str, str]:
        job = self.lifecycle.items.get(job_id)
        if job is None:
            persisted = self.lifecycle.store.get(job_id)
            if persisted and persisted["state"] in {"succeeded", "failed", "cancelled"}:
                return {"jobId": job_id, "state": str(persisted["state"])}
            raise RuntimeFault(RuntimeErrorInfo("JOB_NOT_FOUND", "找不到此任务"))
        if terminal_state(job.state) or job.state is JobState.CANCELLING:
            return {"jobId": job_id, "state": job.state.value}
        await self.lifecycle.transition(job_id, JobEvent.CANCEL_REQUESTED)
        task = self.tasks.get(job_id)
        if task:
            if self.active_job_id == job_id:
                if self.runtime.worker:
                    try:
                        await asyncio.wait_for(self.runtime.worker.cancel(job_id), 1)
                    except (TimeoutError, RuntimeError):
                        task.cancel()
                try:
                    await asyncio.wait_for(asyncio.shield(task), timeout=5)
                except TimeoutError:
                    # Cancellation cleanup stops the Worker before releasing the lease.
                    task.cancel()
            else:
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await self.lifecycle.finish_failed_or_cancelled(job_id, "CANCELLED")
        return {"jobId": job_id, "state": self.lifecycle.items[job_id].state.value}

    def schedule_prepared(
        self,
        job: Job,
        prepare: Callable[[], Awaitable[T]],
        execute: Callable[[T], Awaitable[R]],
        finalize: Callable[[R, T], Awaitable[None]],
    ) -> asyncio.Task[None]:
        task = asyncio.create_task(self._run_prepared(job, prepare, execute, finalize))
        self.tasks[job.id] = task
        task.add_done_callback(lambda done: self._forget(job.id, done))
        return task

    async def _run_prepared(
        self,
        job: Job,
        prepare: Callable[[], Awaitable[T]],
        execute: Callable[[T], Awaitable[R]],
        finalize: Callable[[R, T], Awaitable[None]],
    ) -> None:
        try:
            self._check_cancelled(job.id)
            await self.lifecycle.transition(job.id, JobEvent.PREPARE)
            for attempt in range(2):
                try:
                    await self.lifecycle.set_phase(job.id, "preparing_context")
                    prepared = await prepare()
                    self._check_cancelled(job.id)
                    reply = await self._prepared_lease(job, execute, prepared)
                    await finalize(reply, prepared)
                    break
                except ContextRebuildRequired:
                    if attempt:
                        raise RuntimeFault(
                            RuntimeErrorInfo("CONTEXT_BUDGET_EXCEEDED", "重建后仍超预算")
                        ) from None

        except asyncio.CancelledError:
            await self.lifecycle.finish_failed_or_cancelled(job.id, "RUNTIME_SHUTDOWN")
            raise
        except TimeoutError:
            await self.lifecycle.finish_failed_or_cancelled(job.id, "INFERENCE_TIMEOUT")
        except RuntimeFault as error:
            await self.lifecycle.finish_failed_or_cancelled(job.id, error.info.code)
        except (
            Exception
        ):  # Task boundary; preparation/finalization never stop another lease's Worker.
            LOGGER.exception("Prepared job failed", extra={"job_id": job.id})
            await self.lifecycle.finish_failed_or_cancelled(job.id, "INFERENCE_FAILED")

    async def _prepared_lease(
        self, job: Job, execute: Callable[[T], Awaitable[R]], prepared: T
    ) -> R:
        await self.lifecycle.set_phase(job.id, "waiting_model")
        async with self.lock:
            self._check_cancelled(job.id)
            self.check_resources_available()
            self.active_job_id = job.id
            worker = self.runtime.worker
            try:
                async with asyncio.timeout(self.timeout_seconds):
                    await self.lifecycle.set_phase(job.id, "loading_model")
                    await self.runtime.load(job.model_id or "")
                    worker = self.runtime.worker
                    self._check_cancelled(job.id)
                    if self.lifecycle.get(job.id).state is JobState.PREPARING:
                        await self.lifecycle.transition(job.id, JobEvent.START)
                    await self.lifecycle.set_phase(job.id, "generating")
                    return await execute(prepared)
            except ContextRebuildRequired:
                raise
            except BaseException:
                try:
                    if worker is not None:
                        await self.runtime.stop(worker)
                except Exception:
                    self.poisoned = True
                    raise
                raise
            finally:
                self.active_job_id = None

    def _check_cancelled(self, job_id: str) -> None:
        if self.lifecycle.cancellation_requested(job_id):
            raise asyncio.CancelledError

    @asynccontextmanager
    async def reserve_removal(self, model_id: str) -> AsyncIterator[None]:
        if model_id in self.removing:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_IN_USE", "模型正在移除", True))
        model = self.runtime.models.get(model_id)
        path = model.local_path if model else None
        aliases = {
            key
            for key, item in self.runtime.models.items()
            if path is not None and item.local_path == path
        }
        aliases.add(model_id)
        for job in self.lifecycle.items.values():
            task = self.tasks.get(job.id)
            if job.model_id in aliases and (
                not terminal_state(job.state) or (task is not None and not task.done())
            ):
                raise RuntimeFault(RuntimeErrorInfo("MODEL_IN_USE", "模型仍被任务引用", True))
        self.removing.update(aliases)
        if path is not None:
            self.removing_paths.add(path)
        try:
            async with self.lock:
                yield
        finally:
            self.removing.difference_update(aliases)
            if path is not None:
                self.removing_paths.discard(path)

    def _forget(self, job_id: str, task: asyncio.Task[None]) -> None:
        if self.tasks.get(job_id) is task:
            self.tasks.pop(job_id, None)
        if not task.cancelled() and task.exception():
            LOGGER.error("Task cleanup failed", extra={"job_id": job_id})
        self.lifecycle.prune(set(self.tasks))

    async def close(self) -> None:
        tasks = tuple(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for job in tuple(self.lifecycle.items.values()):
            if not terminal_state(job.state):
                await self.lifecycle.finish_failed_or_cancelled(job.id, "RUNTIME_SHUTDOWN")
        await self.runtime.stop()
