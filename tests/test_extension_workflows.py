"""Real Node Host, Pi, scoped HTTP inference and two media jobs through FakeEngine."""

import asyncio
import unittest

import test_coding_workspace as coding


class ExtensionWorkflowTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = coding.CodingWorkspaceTests.asyncSetUp
    asyncTearDown = coding.CodingWorkspaceTests.asyncTearDown
    post = coding.CodingWorkspaceTests.post
    snapshot = coding.CodingWorkspaceTests.snapshot
    until = coding.CodingWorkspaceTests.until
    create = coding.CodingWorkspaceTests.create

    async def test_coding_and_agent_chat_use_scoped_media_and_keep_metadata_separate(
        self,
    ):
        await self.post("/capabilities/builtin-fake-text/verify")
        selection = {
            "skillIds": [],
            "toolIds": ["builtin:image_generate", "builtin:speech_generate"],
            "mediaBindings": {
                "imageModelId": "builtin-fake-image",
                "speechModelId": "builtin-fake-audio",
                "speechMode": "preset",
                "speaker": "demo",
            },
        }
        _, session_id = await self.create()
        command = {
            "submissionId": "coding-media",
            "modelId": "builtin-fake-text",
            "mode": "develop",
            "text": "Local capability probe: generate an image and speech.",
            "selection": selection,
        }
        run = await self.post(f"/sessions/{session_id}/runs", command)
        approved = set()
        for _ in range(400):
            state = await self.snapshot(session_id)
            for approval in state["approvals"]:
                if approval["status"] == "pending" and approval["id"] not in approved:
                    approved.add(approval["id"])
                    self.assertEqual(approval["action"], "mcp")
                    await self.post(
                        f"/approvals/{approval['id']}/resolve", {"allowed": True}
                    )
            if state["runs"] and state["runs"][-1]["status"] in {
                "completed",
                "failed",
                "cancelled",
            }:
                break
            await asyncio.sleep(0.03)
        self.assertEqual(state["runs"][-1]["status"], "completed", state)
        self.assertEqual(len(approved), 2)
        self.assertEqual(
            len(
                [event for event in state["events"] if event["type"] == "tool.started"]
            ),
            2,
        )
        self.assertEqual(
            (await self.post(f"/sessions/{session_id}/runs", command))["id"], run["id"]
        )
        images = (await self.client.get("/internal/v1/image-artifacts")).json()
        speech = (await self.client.get("/internal/v1/audio-artifacts")).json()
        self.assertEqual(len(images), 1)
        self.assertEqual(len(speech), 1)
        self.assertTrue(
            (
                await self.client.get(
                    f"/internal/v1/image-artifacts/{images[0]['id']}/content"
                )
            ).content.startswith(b"\x89PNG")
        )
        self.assertTrue(
            (
                await self.client.get(
                    f"/internal/v1/audio-artifacts/{speech[0]['id']}/content"
                )
            ).content.startswith(b"RIFF")
        )

        root = "/internal/v1/agent-chat"
        created = await self.client.post(
            root + "/sessions", json={"title": "Independent tool chat"}
        )
        self.assertEqual(created.status_code, 200, created.text)
        agent_session = created.json()["id"]
        command = {**command, "submissionId": "agent-media"}
        submitted = await self.client.post(
            root + f"/sessions/{agent_session}/runs", json=command
        )
        self.assertEqual(submitted.status_code, 200, submitted.text)
        for _ in range(400):
            response = await self.client.get(root + f"/sessions/{agent_session}")
            self.assertEqual(response.status_code, 200, response.text)
            state = response.json()
            for approval in state["approvals"]:
                if approval["status"] == "pending" and approval["id"] not in approved:
                    approved.add(approval["id"])
                    await self.client.post(
                        root + f"/approvals/{approval['id']}/resolve",
                        json={"allowed": True},
                    )
            if state["runs"][-1]["status"] in {"completed", "failed", "cancelled"}:
                break
            await asyncio.sleep(0.03)
        self.assertEqual(state["runs"][-1]["status"], "completed", state)
        self.assertEqual(len(approved), 4)
        self.assertEqual(len((await self.snapshot(session_id))["runs"]), 1)
        self.assertNotIn("project", state)
        self.assertEqual((self.project / "probe.txt").read_text(), "before\n")
