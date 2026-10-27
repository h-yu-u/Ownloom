"""Immutable job lifecycle and event transition rules."""

from dataclasses import dataclass
from enum import StrEnum


class JobState(StrEnum):
    QUEUED = "queued"
    PREPARING = "preparing"
    RUNNING = "running"
    CANCELLING = "cancelling"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobEvent(StrEnum):
    PREPARE = "prepare"
    START = "start"
    COMPLETE = "complete"
    CANCEL_REQUESTED = "cancel_requested"
    CANCEL_COMPLETE = "cancel_complete"
    FAIL = "fail"


class InvalidJobTransition(ValueError):
    """Raised when an event is not valid for a job's current state."""


TRANSITIONS: dict[JobState, dict[JobEvent, JobState]] = {
    JobState.QUEUED: {
        JobEvent.PREPARE: JobState.PREPARING,
        JobEvent.CANCEL_REQUESTED: JobState.CANCELLING,
        JobEvent.FAIL: JobState.FAILED,
    },
    JobState.PREPARING: {
        JobEvent.START: JobState.RUNNING,
        JobEvent.CANCEL_REQUESTED: JobState.CANCELLING,
        JobEvent.FAIL: JobState.FAILED,
    },
    JobState.RUNNING: {
        JobEvent.COMPLETE: JobState.SUCCEEDED,
        JobEvent.CANCEL_REQUESTED: JobState.CANCELLING,
        JobEvent.FAIL: JobState.FAILED,
    },
    JobState.CANCELLING: {
        JobEvent.CANCEL_COMPLETE: JobState.CANCELLED,
        JobEvent.FAIL: JobState.FAILED,
    },
    JobState.SUCCEEDED: {},
    JobState.FAILED: {},
    JobState.CANCELLED: {},
}


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    state: JobState
    model_id: str | None = None
    error_code: str | None = None


def transition_job(job: Job, event: JobEvent, error_code: str | None = None) -> Job:
    next_state = TRANSITIONS[job.state].get(event)
    if next_state is None:
        raise InvalidJobTransition(f"{event.value} is invalid from {job.state.value}")
    return Job(
        id=job.id,
        kind=job.kind,
        state=next_state,
        model_id=job.model_id,
        error_code=error_code if next_state is JobState.FAILED else None,
    )


def terminal_state(state: JobState) -> bool:
    return state in {JobState.SUCCEEDED, JobState.FAILED, JobState.CANCELLED}
