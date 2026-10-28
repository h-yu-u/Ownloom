"""Job state transitions with persistence and event publication."""

from collections.abc import Callable, Mapping
from types import MappingProxyType
from typing import Any

from mlx_studio_runtime.application.ports import EventPublisher, JobRepository, Transaction
from mlx_studio_runtime.domain.generation_stats import GenerationStats
from mlx_studio_runtime.domain.jobs import (
    Job,
    JobEvent,
    JobState,
    terminal_state,
    transition_job,
)


class JobLifecycle:
    def __init__(
        self, store: JobRepository, events: EventPublisher, transaction: Transaction
    ) -> None:
        self.store = store
        self.events = events
        self.transaction = transaction
        self._items: dict[str, Job] = {}
        self._output: dict[str, str] = {}
        self._text_revisions: dict[str, int] = {}
        self._generation_stats: dict[str, GenerationStats] = {}

    def save_result(self, job_id: str, result: dict[str, Any]) -> None:
        self.store.save_result(job_id, result)

    @property
    def items(self) -> Mapping[str, Job]:
        return MappingProxyType(self._items)

    def get(self, job_id: str) -> Job:
        return self._items[job_id]

    def cancellation_requested(self, job_id: str) -> bool:
        return self.get(job_id).state is JobState.CANCELLING

    def output_text(self, job_id: str) -> str:
        return self._output.get(job_id, "")

    def text_revision(self, job_id: str) -> int:
        return self._text_revisions.get(job_id, 0)

    def generation_stats(self, job_id: str) -> GenerationStats | None:
        stats = self._generation_stats.get(job_id)
        return stats.copy() if stats is not None else None

    async def set_phase(self, job_id: str, phase: str) -> None:
        if terminal_state(self.get(job_id).state) or self.cancellation_requested(job_id):
            return
        version = self.store.set_phase(job_id, phase)
        await self.events.publish(
            "job.phase_changed", {"job_id": job_id, "phase": phase, "projectionVersion": version}
        )

    def prune(self, retained: set[str], limit: int = 200) -> None:
        for job in tuple(self._items.values()):
            if len(self._items) <= limit:
                break
            if job.id not in retained and terminal_state(job.state):
                self._items.pop(job.id)
                self._output.pop(job.id, None)
                self._text_revisions.pop(job.id, None)
                self._generation_stats.pop(job.id, None)

    async def register(
        self, job: Job, request: dict[str, object], persist: Callable[[], None] | None = None
    ) -> None:
        with self.transaction():
            self.store.save(
                {
                    "id": job.id,
                    "kind": job.kind,
                    "state": job.state.value,
                    "modelId": job.model_id,
                    "request": request,
                }
            )
            if persist:
                persist()
        self._items[job.id] = job
        await self.events.publish(
            "job.updated",
            {"job_id": job.id, "state": job.state.value},
        )

    async def transition(self, job_id: str, event: JobEvent) -> Job:
        updated = transition_job(self._items[job_id], event)
        self.store.update(job_id, updated.state.value)
        self._items[job_id] = updated
        await self.events.publish(
            "job.updated",
            {"job_id": job_id, "state": updated.state.value},
        )
        return updated

    async def finish(
        self,
        job_id: str,
        event: JobEvent,
        error_code: str | None = None,
        persist: Callable[[], None] | None = None,
        finish_reason: str | None = None,
    ) -> Job:
        current = self._items[job_id]
        if terminal_state(current.state):
            return current
        if current.state is JobState.CANCELLING and event is JobEvent.COMPLETE:
            event, persist = JobEvent.CANCEL_COMPLETE, None
        updated = transition_job(current, event, error_code)
        with self.transaction():
            if persist:
                persist()
            self.store.update(job_id, updated.state.value, updated.error_code)
        self._items[job_id] = updated
        self._generation_stats.pop(job_id, None)
        await self.events.publish(
            f"job.{updated.state.value}",
            {
                "job_id": job_id,
                "state": updated.state.value,
                "error_code": updated.error_code,
                **({"finish_reason": finish_reason} if finish_reason else {}),
            },
        )
        return updated

    async def finish_failed_or_cancelled(self, job_id: str, error_code: str) -> Job:
        current = self._items[job_id]
        if terminal_state(current.state):
            return current
        if current.state is JobState.CANCELLING:
            return await self.finish(job_id, JobEvent.CANCEL_COMPLETE)
        return await self.finish(job_id, JobEvent.FAIL, error_code)

    def append_output(
        self, job_id: str, text: str, generation_stats: GenerationStats | None = None
    ) -> None:
        if self.get(job_id).state is not JobState.RUNNING:
            return
        self._output[job_id] = self._output.get(job_id, "") + text
        self._text_revisions[job_id] = self.text_revision(job_id) + 1
        if generation_stats is None:
            self._generation_stats.pop(job_id, None)
        else:
            self._generation_stats[job_id] = generation_stats.copy()
