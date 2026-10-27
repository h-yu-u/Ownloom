import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "runtime" / "src"))

from mlx_studio_runtime.domain.jobs import (
    InvalidJobTransition,
    Job,
    JobEvent,
    JobState,
    terminal_state,
    transition_job,
)
from mlx_studio_runtime.domain.runtime_state import RuntimeState, transition_runtime


class JobStateTests(unittest.TestCase):
    def test_happy_path_and_cancel_path_reach_terminal_states(self) -> None:
        job = Job("job-1", "chat", JobState.QUEUED)
        job = transition_job(job, JobEvent.PREPARE)
        job = transition_job(job, JobEvent.START)
        job = transition_job(job, JobEvent.COMPLETE)
        self.assertEqual(job.state, JobState.SUCCEEDED)
        self.assertTrue(terminal_state(job.state))

        cancelled = transition_job(
            Job("job-2", "chat", JobState.QUEUED), JobEvent.CANCEL_REQUESTED
        )
        cancelled = transition_job(cancelled, JobEvent.CANCEL_COMPLETE)
        self.assertEqual(cancelled.state, JobState.CANCELLED)

    def test_rejects_transition_from_terminal_state(self) -> None:
        job = Job("job-1", "chat", JobState.SUCCEEDED)
        with self.assertRaises(InvalidJobTransition):
            transition_job(job, JobEvent.CANCEL_REQUESTED)


class RuntimeStateTests(unittest.TestCase):
    def test_worker_failure_degrades_runtime_then_recovers(self) -> None:
        state = transition_runtime(RuntimeState.READY, "worker_lost")
        self.assertEqual(state, RuntimeState.DEGRADED)
        self.assertEqual(transition_runtime(state, "worker_ready"), RuntimeState.READY)


if __name__ == "__main__":
    unittest.main()
