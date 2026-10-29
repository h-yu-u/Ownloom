"""Real Node Pi SDK + HTTP/NDJSON + scripted Worker integration and recovery."""

import asyncio
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path

import httpx
from mlx_studio_runtime.adapters.agent_host import AgentHost
from runtime_fixtures import seed_fake_database

ROOT = Path(__file__).parents[1]
PREFIX = "/internal/v1/coding"
PROBE = "Coding capability probe: read probe.txt, change it to after followed by newline, then run exactly /usr/bin/grep -qx 'after' probe.txt. Repair failed checks."


class CodingWorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mlx-coding-integration-")
        self.directory = Path(self.temp.name)
        seed_fake_database(self.directory / "app.db")
        self.project = self.directory / "中文 project"
        self.project.mkdir()
        (self.project / "probe.txt").write_text("before\n")
        (self.project / "user.txt").write_text("用户原有修改\n")
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.close()
        sidecar = os.getenv("MLX_STUDIO_TEST_SIDECAR")
        command = (
            [sidecar]
            if sidecar
            else [
                sys.executable,
                "-m",
                "uvicorn",
                "mlx_studio_runtime.entrypoints.http.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ]
        )
        self.process = await asyncio.create_subprocess_exec(
            *command,
            cwd=ROOT,
            env={
                **os.environ,
                "PYTHONPATH": str(ROOT / "services/runtime/src"),
                "MLX_STUDIO_SESSION_TOKEN": "integration",
                "MLX_STUDIO_DATA_DIR": self.temp.name,
            },
            stdout=asyncio.subprocess.PIPE if sidecar else asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        if sidecar:
            assert self.process.stdout is not None
            import json

            frame = json.loads(
                await asyncio.wait_for(self.process.stdout.readline(), 60)
            )
            port = frame["port"]
        self.client = httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}",
            headers={"Authorization": "Bearer integration"},
            timeout=30,
        )
        for _ in range(100):
            try:
                if (
                    await self.client.get("/internal/v1/runtime/info")
                ).status_code == 200:
                    break
            except httpx.ConnectError:
                pass
            await asyncio.sleep(0.05)
        else:
            self.fail("Runtime did not start")

    async def asyncTearDown(self):
        await self.client.aclose()
        if self.process.returncode is None:
            self.process.terminate()
        await asyncio.wait_for(self.process.wait(), 10)
        self.temp.cleanup()

    async def post(self, path, body=None, expected=200):
        response = await self.client.post(PREFIX + path, json=body)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    async def snapshot(self, session):
        response = await self.client.get(PREFIX + f"/sessions/{session}/snapshot")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def until(self, session, predicate):
        for _ in range(300):
            snapshot = await self.snapshot(session)
            if predicate(snapshot):
                return snapshot
            await asyncio.sleep(0.02)
        self.fail("Coding state did not converge")

    async def create(self):
        project = await self.post("/projects", {"path": str(self.project)})
        session = await self.post(f"/projects/{project['id']}/sessions", {})
        return project, session["id"]

    async def test_pi_fail_repair_approvals_versions_and_chat_regression(self):
        _project, session = await self.create()
        command = {
            "submissionId": "first",
            "text": PROBE,
            "modelId": "builtin-fake-text",
            "mode": "develop",
        }
        await self.post(f"/sessions/{session}/runs", command, 400)
        capability = await self.post("/capabilities/builtin-fake-text/verify")
        self.assertEqual(capability["status"], "verified")
        run = await self.post(f"/sessions/{session}/runs", command)
        retry = await self.post(f"/sessions/{session}/runs", command)
        self.assertEqual(run["id"], retry["id"])
        await self.post(
            f"/sessions/{session}/runs", {**command, "text": "different"}, 409
        )
        allowed = set()
        for _ in range(300):
            state = await self.snapshot(session)
            for approval in state["approvals"]:
                if approval["status"] == "pending" and approval["id"] not in allowed:
                    blocked = await self.client.post(
                        "/internal/v1/models/builtin-fake-text/draft",
                        json={"enabled": False},
                    )
                    self.assertEqual(blocked.status_code, 409, blocked.text)
                    self.assertEqual(blocked.json()["error"]["code"], "MODEL_IN_USE")
                    allowed.add(approval["id"])
                    await self.post(
                        f"/approvals/{approval['id']}/resolve", {"allowed": True}
                    )
            if state["runs"][-1]["status"] in {"completed", "failed", "cancelled"}:
                break
            await asyncio.sleep(0.02)
        self.assertEqual(state["runs"][-1]["status"], "completed", state)
        self.assertEqual(state["runs"][-1]["verification"], "not_run")
        self.assertTrue(
            all(item["purpose"] == "command" for item in state["verifications"])
        )
        tools = [
            (e["type"], e["text"])
            for e in state["events"]
            if e["type"] in {"tool.started", "tool.finished"}
        ]
        self.assertEqual(
            tools[:4],
            [
                ("tool.started", "list"),
                ("tool.finished", "list"),
                ("tool.started", "read"),
                ("tool.finished", "read"),
            ],
        )
        self.assertIn(1, [item["exitCode"] for item in state["verifications"]])
        self.assertIn(0, [item["exitCode"] for item in state["verifications"]])
        self.assertEqual((self.project / "user.txt").read_text(), "用户原有修改\n")
        self.assertTrue(Path(state["session"]["piPath"]).is_file())
        changes = (
            await self.client.get(PREFIX + f"/sessions/{session}/changes")
        ).json()["managed"]
        self.assertEqual(len(changes), 2)
        (self.project / "probe.txt").write_text("manual edit")
        fresh = await self.snapshot(session)
        self.assertTrue(all(item["stale"] for item in fresh["verifications"]))
        self.assertEqual(fresh["runs"][-1]["verification"], "not_run")
        await self.post(f"/changes/{changes[-1]['id']}/restore", expected=409)
        self.assertEqual((self.project / "probe.txt").read_text(), "manual edit")
        (self.project / "probe.txt").write_text("after\n")
        await self.post(f"/changes/{changes[-1]['id']}/restore")
        self.assertEqual((self.project / "probe.txt").read_text(), "broken\n")
        restored = await self.snapshot(session)
        self.assertEqual(restored["runs"][-1]["verification"], "not_run")
        # Coding did not create ordinary chat histories; existing chat/engine paths still work.
        self.assertEqual(
            (await self.client.get("/internal/v1/conversations")).json(), []
        )
        chat = (
            await self.client.post(
                "/internal/v1/conversations",
                json={"title": "regression", "model_id": "builtin-fake-text"},
            )
        ).json()
        self.assertTrue(chat["id"])
        models = await self.client.get("/internal/v1/models")
        self.assertEqual(models.status_code, 200)

    async def test_normal_tasks_do_not_run_legacy_project_verification_commands(self):
        project, session = await self.create()
        await self.post("/capabilities/builtin-fake-text/verify")
        response = await self.client.patch(
            PREFIX + f"/projects/{project['id']}",
            json={"commands": ["touch legacy-verification-marker"]},
        )
        self.assertEqual(response.status_code, 200)
        await self.post(
            f"/sessions/{session}/runs",
            {
                "submissionId": "normal",
                "text": "正常开发任务",
                "modelId": "builtin-fake-text",
                "mode": "develop",
            },
        )
        state = await self.until(
            session, lambda s: s["runs"][-1]["status"] == "completed"
        )
        self.assertFalse(state["approvals"])
        self.assertFalse(state["verifications"])
        self.assertFalse((self.project / "legacy-verification-marker").exists())

    async def test_denial_cancellation_queue_and_no_inference_lock_during_approval(
        self,
    ):
        project, session = await self.create()
        await self.post("/capabilities/builtin-fake-text/verify")
        response = await self.client.patch(
            PREFIX + f"/projects/{project['id']}",
            json={"commands": ["touch denied-marker"]},
        )
        self.assertEqual(response.status_code, 200)
        run = await self.post(
            f"/sessions/{session}/verify",
            {
                "submissionId": "verify",
                "text": "verify",
                "modelId": "builtin-fake-text",
            },
        )
        state = await self.until(
            session, lambda s: any(a["status"] == "pending" for a in s["approvals"])
        )
        # A normal model operation can get the same lease while Coding waits for permission.
        loaded = await self.client.post("/internal/v1/models/builtin-fake-text/load")
        self.assertEqual(loaded.status_code, 200)
        approval = next(a for a in state["approvals"] if a["status"] == "pending")
        await self.post(f"/approvals/{approval['id']}/resolve", {"allowed": False})
        await self.until(session, lambda s: s["runs"][-1]["status"] == "failed")
        self.assertFalse((self.project / "denied-marker").exists())
        await self.post(f"/approvals/{approval['id']}/resolve", {"allowed": True}, 400)
        run = await self.post(
            f"/sessions/{session}/verify",
            {
                "submissionId": "second",
                "text": "verify",
                "modelId": "builtin-fake-text",
            },
        )
        await self.until(
            session,
            lambda s: (
                s["activeRun"] and s["activeRun"]["status"] == "awaiting_approval"
            ),
        )
        queued = await self.post(
            f"/sessions/{session}/runs",
            {
                "submissionId": "queue",
                "text": "next task",
                "modelId": "builtin-fake-text",
                "mode": "analyze",
                "queue": True,
            },
        )
        self.assertEqual(queued["status"], "queued")
        blocked = await self.client.post(
            "/internal/v1/models/builtin-fake-text/mtp", json={"draftPath": None}
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertEqual(blocked.json()["error"]["code"], "MODEL_IN_USE")
        await self.post(f"/runs/{run['id']}/cancel")
        state = await self.until(
            session, lambda s: s["runs"][-1]["status"] == "completed"
        )
        self.assertEqual(state["runs"][-2]["status"], "cancelled")
        self.assertFalse((self.project / "denied-marker").exists())

    async def test_full_access_and_live_permission_change_through_http(self):
        await self.post("/capabilities/builtin-fake-text/verify")
        for permission in ("full", "ask"):
            with self.subTest(permission=permission):
                (self.project / "probe.txt").write_text("before\n")
                _project, session = await self.create()
                command = {
                    "submissionId": "access-test",
                    "text": PROBE,
                    "modelId": "builtin-fake-text",
                    "mode": "develop",
                    "permissionMode": permission,
                }
                run = await self.post(f"/sessions/{session}/runs", command)
                self.assertEqual(run["permissionMode"], permission)
                if permission == "ask":
                    await self.until(
                        session,
                        lambda s: any(a["status"] == "pending" for a in s["approvals"]),
                    )
                    response = await self.client.patch(
                        PREFIX + f"/runs/{run['id']}/permissions",
                        json={"permissionMode": "full"},
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()["permissionMode"], "full")
                state = await self.until(
                    session, lambda s: s["runs"][-1]["status"] == "completed"
                )
                self.assertTrue(state["approvals"])
                self.assertTrue(
                    all(a["status"] == "allowed" for a in state["approvals"])
                )
                self.assertEqual((self.project / "probe.txt").read_text(), "after\n")
                retry = await self.post(f"/sessions/{session}/runs", command)
                self.assertEqual(retry["id"], run["id"])
                if permission == "full":
                    self.assertFalse(
                        any(e["type"] == "approval.requested" for e in state["events"])
                    )

    async def test_host_crash_invalidates_approval_and_interrupts_run(self):
        host = AgentHost(self.directory / "host-recovery")
        try:
            project = await host.request(
                "projects.register", {"path": str(self.project)}
            )
            session = await host.request(
                "sessions.create", {"projectId": project["id"]}
            )
            await host.request(
                "projects.update",
                {"id": project["id"], "commands": ["touch should-not-replay"]},
            )
            await host.request(
                "sessions.verify",
                {
                    "sessionId": session["id"],
                    "submissionId": "verify",
                    "provider": {
                        "modelId": "fake",
                        "baseUrl": "http://127.0.0.1:1/internal/v1/inference",
                        "token": "narrow",
                        "contextWindow": 32768,
                    },
                },
            )
            for _ in range(100):
                snapshot = await host.request(
                    "sessions.snapshot", {"id": session["id"]}
                )
                if snapshot["approvals"]:
                    break
                await asyncio.sleep(0.02)
            self.assertEqual(snapshot["approvals"][0]["status"], "pending")
            host.process.kill()
            await host.process.wait()
            await asyncio.sleep(0.05)
            recovered = await host.request("sessions.snapshot", {"id": session["id"]})
            self.assertEqual(recovered["runs"][0]["status"], "interrupted")
            self.assertEqual(recovered["approvals"][0]["status"], "denied")
            self.assertFalse((self.project / "should-not-replay").exists())
        finally:
            await host.close()

    async def test_host_crash_reaps_owned_command_process_group(self):
        host = AgentHost(self.directory / "host-process-recovery")
        try:
            project = await host.request(
                "projects.register", {"path": str(self.project)}
            )
            session = await host.request(
                "sessions.create", {"projectId": project["id"]}
            )
            await host.request(
                "projects.update",
                {"id": project["id"], "commands": ["sleep 30 & wait"]},
            )
            await host.request(
                "sessions.verify",
                {
                    "sessionId": session["id"],
                    "submissionId": "owned-command",
                    "provider": {
                        "modelId": "fake",
                        "baseUrl": "http://127.0.0.1:1/internal/v1/inference",
                        "token": "narrow",
                        "contextWindow": 32768,
                    },
                },
            )
            for _ in range(100):
                state = await host.request("sessions.snapshot", {"id": session["id"]})
                if state["approvals"]:
                    break
                await asyncio.sleep(0.02)
            await host.request(
                "approvals.resolve",
                {"id": state["approvals"][0]["id"], "allowed": True},
            )
            for _ in range(100):
                if host.command_pids:
                    break
                await asyncio.sleep(0.02)
            self.assertTrue(host.command_pids)
            pid = next(iter(host.command_pids))
            host.process.kill()
            await host.process.wait()
            for _ in range(100):
                try:
                    os.killpg(pid, 0)
                except ProcessLookupError:
                    break
                except PermissionError:
                    pass  # Darwin can report EPERM during final process-group reaping.
                await asyncio.sleep(0.02)
            else:
                self.fail("Command process group survived host crash")
            self.assertFalse(host.command_pids)
        finally:
            await host.close()
