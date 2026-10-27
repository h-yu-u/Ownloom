import unittest
from contextlib import nullcontext
from unittest.mock import AsyncMock, Mock

from mlx_studio_runtime.application.job_lifecycle import JobLifecycle
from mlx_studio_runtime.domain.jobs import Job, JobEvent, JobState


class JobReadOnlyTests(unittest.IsolatedAsyncioTestCase):
    async def test_read_only_snapshots_and_pruning_stay_with_lifecycle(self):
        lifecycle = JobLifecycle(Mock(), AsyncMock(), nullcontext)
        job = Job("job", "audio", JobState.QUEUED)
        await lifecycle.register(job, {})
        with self.assertRaises(TypeError):
            lifecycle.items["other"] = job
        original = lifecycle.get("job")
        await lifecycle.transition("job", JobEvent.PREPARE)
        await lifecycle.transition("job", JobEvent.START)
        await lifecycle.finish("job", JobEvent.COMPLETE)
        self.assertEqual(original.state, JobState.QUEUED)
        lifecycle.append_output("job", "text")
        lifecycle.prune({"job"}, 0)
        self.assertIn("job", lifecycle.items)
        lifecycle.prune(set(), 0)
        self.assertEqual(lifecycle.items, {})
        self.assertEqual(lifecycle.output_text("job"), "")
