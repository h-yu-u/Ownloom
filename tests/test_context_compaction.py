import copy
import unittest
from unittest.mock import AsyncMock, Mock

from mlx_studio_runtime.application.context_compaction import compact_history
from mlx_studio_runtime.domain.errors import RuntimeFault


class ContextCompactionTests(unittest.IsolatedAsyncioTestCase):
    async def test_preserves_early_constraint_recent_turn_and_reuses_frozen_summary(
        self,
    ):
        history = [
            {"role": role, "content": ("keep-123 " if i == 0 else "old fact ") * 180}
            for i in range(20)
            for role in ["user" if i % 2 == 0 else "assistant"]
        ]
        original = copy.deepcopy(history)
        request = {
            "acceptedSnapshot": {"history": history},
            "content": "current question",
            "maxTokens": 512,
            "conversationId": "chat",
            "modelId": "model",
            "modelRevision": "revision",
        }
        contexts = Mock()
        contexts.summary.return_value = None
        infer = AsyncMock(
            return_value={
                "message": {"content": "Early constraint: keep-123"},
                "finish_reason": "stop",
            }
        )
        compacted = await compact_history(request, 4096, contexts, infer)
        self.assertIn("keep-123", compacted[0]["content"])
        self.assertEqual(compacted[-2:], history[-2:])
        self.assertEqual(history, original)
        self.assertGreater(infer.await_count, 1)
        self.assertLessEqual(infer.await_count, 16)
        contexts.save_summary.assert_called_once()
        contexts.summary.return_value = {"content": "Early constraint: keep-123"}
        infer.reset_mock()
        self.assertEqual(
            await compact_history(request, 4096, contexts, infer), compacted
        )
        infer.assert_not_awaited()

    async def test_failed_summary_never_replaces_original_history(self):
        history = [
            {"role": "user", "content": "constraint " * 500},
            {"role": "assistant", "content": "answer " * 400},
            {"role": "user", "content": "recent"},
            {"role": "assistant", "content": "recent answer"},
        ]
        request = {
            "acceptedSnapshot": {"history": history},
            "content": "question",
            "maxTokens": 512,
            "conversationId": "chat",
            "modelId": "model",
        }
        original = copy.deepcopy(request)
        contexts = Mock()
        contexts.summary.return_value = None
        infer = AsyncMock(
            return_value={
                "message": {"content": "truncated"},
                "finish_reason": "length",
            }
        )
        with self.assertRaises(RuntimeFault):
            await compact_history(request, 4096, contexts, infer)
        self.assertEqual(request, original)
        contexts.save_summary.assert_not_called()
