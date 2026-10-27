"""Global summaries remain readable without reconstructing historical chat contexts."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from mlx_studio_runtime.adapters.persistence.capability_ledger import CapabilityLedger
from runtime_fixtures import create_test_app


class TaskCenterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.app = create_test_app("test", Path(self.temporary.name) / "app.db")
        self.service = self.app.state.service

    async def asyncTearDown(self):
        await self.service.close()
        self.temporary.cleanup()

    async def test_legacy_chat_summary_does_not_load_context_or_private_content(self):
        self.service.store.jobs.save(
            {
                "id": "legacy",
                "kind": "chat",
                "state": "succeeded",
                "request": {"conversationId": "old-chat", "content": "private prompt"},
            }
        )
        transport = httpx.ASGITransport(app=self.app, raise_app_exceptions=False)
        with patch.object(self.service.coding, "call", AsyncMock(return_value=[])):
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                response = await client.get(
                    "/internal/v1/tasks", headers={"Authorization": "Bearer test"}
                )
        self.assertEqual(response.status_code, 200, response.text)
        items = response.json()
        self.assertEqual(len(items), 1)
        for key, value in {
            "owner": "runtime",
            "id": "legacy",
            "state": "succeeded",
            "phase": "accepted",
            "sessionId": "old-chat",
            "needsApproval": False,
            "errorCode": None,
            "target": "/chat?conversationId=old-chat",
            "groupId": "chat:old-chat",
            "title": "聊天任务",
            "parentId": None,
        }.items():
            self.assertEqual(items[0][key], value)
        self.assertGreater(items[0]["createdAt"], 0)
        self.assertNotIn("private prompt", response.text)

    async def test_summary_preserves_phase_and_uses_workspace_for_jobs_without_session(
        self,
    ):
        for kind in ("image", "speech", "inference"):
            self.service.store.jobs.save({"id": kind, "kind": kind, "state": "running"})
            self.service.store.jobs.set_phase(kind, "生成中")
        with (
            patch.object(
                self.service.queries, "job", side_effect=AssertionError("full job")
            ),
            patch.object(self.service.coding, "call", AsyncMock(return_value=[])),
        ):
            items = await self.service.data.tasks()
        self.assertEqual({item["phase"] for item in items}, {"生成中"})
        self.assertEqual(
            {item["id"]: item["target"] for item in items},
            {
                "image": "/image-studio",
                "speech": "/audio-studio",
                "inference": "/coding",
            },
        )

    async def test_persisted_inference_parent_inherits_task_identity_and_target(self):
        ledger = CapabilityLedger(self.service.store.database)
        ledger.create("run", "digest", {})
        ledger.reserve("run", "step", "inference", "text", {})
        self.service.store.jobs.save(
            {"id": "child", "kind": "coding-inference", "state": "succeeded"}
        )
        ledger.bind("run", "step", "child")
        parent = {
            "owner": "agent",
            "id": "run",
            "sessionId": "session",
            "title": "整理文档",
            "groupId": "agent:session",
            "state": "completed",
            "phase": "completed",
            "target": "/agent-chat?sessionId=session",
        }
        with patch.object(
            self.service.coding, "call", AsyncMock(return_value=[parent])
        ):
            items = await self.service.data.tasks()
        child = next(item for item in items if item["id"] == "child")
        for key in ("sessionId", "title", "groupId", "target"):
            self.assertEqual(child[key], parent[key])
        self.assertEqual(child["parentId"], parent["id"])

    async def test_old_internal_history_is_not_a_task_but_active_orphans_remain_visible(
        self,
    ):
        for identifier, state in (("old", "succeeded"), ("active", "running")):
            self.service.store.jobs.save(
                {"id": identifier, "kind": "coding-inference", "state": state}
            )
        with patch.object(self.service.coding, "call", AsyncMock(return_value=[])):
            items = await self.service.data.tasks()
        self.assertEqual([item["id"] for item in items], ["active"])

    async def test_chat_titles_are_read_from_the_session_without_loading_the_job_body(
        self,
    ):
        self.service.store.conversations.save({"id": "chat", "title": "火药"})
        for identifier in ("first", "second"):
            self.service.store.jobs.save(
                {
                    "id": identifier,
                    "kind": "chat",
                    "state": "succeeded",
                    "request": {"conversationId": "chat", "content": "private"},
                }
            )
        with patch.object(self.service.coding, "call", AsyncMock(return_value=[])):
            items = await self.service.data.tasks()
        self.assertEqual({item["title"] for item in items}, {"火药"})
        self.assertEqual({item["groupId"] for item in items}, {"chat:chat"})
        self.assertNotIn("private", str(items))
