"""Queue authorization, media idempotency, cancellation windows and secret ownership."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from mlx_studio_runtime.adapters.persistence.capability_ledger import CapabilityLedger
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.application.capability_grants import CapabilityGrants
from mlx_studio_runtime.domain.errors import RuntimeFault
from runtime_fixtures import create_test_runtime

ROOT = Path(__file__).parents[1]


class CapabilityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        store = SQLiteRepositories(Path(self.temp.name) / "app.db")
        self.service = create_test_runtime(store, ROOT / "services/runtime/src")
        self.grants = self.service.capability_grants
        self.service.extensions.validate_text = AsyncMock()
        self.grants.generation = lambda: "test-host"
        self.now = 0.0
        self.grants.clock = lambda: self.now
        self.run = {
            "id": "run-one",
            "modelId": "builtin-fake-text",
            "capabilitySnapshot": {
                "snapshotDigest": "snapshot",
                "workspace": "coding",
                "mode": "develop",
                "skills": [],
                "servers": [],
                "tools": [
                    {
                        "serverId": "builtin",
                        "originalName": "image_generate",
                        "modelName": "image_generate",
                    },
                    {
                        "serverId": "builtin",
                        "originalName": "speech_generate",
                        "modelName": "speech_generate",
                    },
                ],
                "mediaBindings": {
                    "imageModelId": "builtin-fake-image",
                    "speechModelId": "builtin-fake-audio",
                    "speechMode": "preset",
                    "speaker": "demo",
                },
            },
        }

    async def asyncTearDown(self):
        await self.service.close()
        self.temp.cleanup()

    async def activate(self):
        bootstrap = await self.grants.prepare(self.run)
        self.now = 3000
        active = await self.grants.activate(bootstrap)
        self.assertEqual(active, await self.grants.activate(bootstrap))
        return "Bearer " + active["token"]

    async def test_queue_activation_media_artifacts_idempotency_and_no_parent_lease(
        self,
    ):
        token = await self.activate()
        inference = {
            "model": "builtin-fake-text",
            "messages": [{"role": "user", "content": "plain answer"}],
            "tools": [],
            "max_tokens": 128,
            "temperature": 0.5,
        }
        await self.grants.complete(token, inference)
        args = {"prompt": "test image", "width": 64, "height": 64, "steps": 1}
        result = await self.grants.invoke(token, "image-1", "image_generate", args)
        retry = await self.grants.invoke(token, "image-1", "image_generate", args)
        self.assertEqual(result, retry)
        image = self.service.images.get_job(result["childJobId"])
        self.assertEqual(image["state"], "succeeded")
        path = self.service.queries.image_content(result["artifactRefs"][0]["id"])
        self.assertTrue(path.read_bytes().startswith(b"\x89PNG"))
        speech = await self.grants.invoke(
            token, "speech-1", "speech_generate", {"text": "测试语音"}
        )
        self.assertEqual(
            self.service.speech.get_job(speech["childJobId"])["state"], "succeeded"
        )
        await self.grants.complete(token, inference)
        self.assertEqual(len(self.grants.ledger.jobs(self.run["id"])), 4)
        self.assertEqual(self.grants.ledger.scope(self.run["id"])["media_calls"], 2)
        self.assertFalse(self.service.scheduler.lock.locked())
        with self.assertRaises(RuntimeFault) as conflict:
            await self.grants.invoke(
                token, "image-1", "image_generate", {**args, "prompt": "other"}
            )
        self.assertEqual(conflict.exception.info.code, "IDEMPOTENCY_CONFLICT")
        await self.grants.close_run(token)
        self.assertFalse(self.grants.authorized(token))

    async def test_create_succeeds_bind_failure_recovers_same_seed_job_and_artifact(
        self,
    ):
        token = await self.activate()
        original = self.grants.ledger.bind
        calls = 0

        def bind(*args):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OSError("injected bind failure")
            return original(*args)

        self.grants.ledger.bind = bind
        args = {"prompt": "idempotent", "width": 64, "height": 64, "steps": 1}
        with self.assertRaises(OSError):
            await self.grants.invoke(token, "dispatch", "image_generate", args)
        first = self.service.images.list_jobs()[0]
        result = await self.grants.invoke(token, "dispatch", "image_generate", args)
        self.assertEqual(result["childJobId"], first["id"])
        self.assertEqual(
            self.service.images.get_job(first["id"])["seed"], first["seed"]
        )
        self.assertEqual(len(self.service.images.list_jobs()), 1)
        self.assertEqual(self.grants.ledger.scope(self.run["id"])["media_calls"], 1)

    async def test_cancel_waits_for_admission_and_recovers_unbound_created_job(self):
        token = await self.activate()
        created, release = asyncio.Event(), asyncio.Event()
        original = self.grants.bridge.create

        async def create(*args):
            job_id = await original(*args)
            created.set()
            await release.wait()
            return job_id

        self.grants.bridge.create = create
        invocation = asyncio.create_task(
            self.grants.invoke(
                token,
                "dispatch",
                "image_generate",
                {"prompt": "cancel", "width": 64, "height": 64, "steps": 50},
            )
        )
        await created.wait()
        closing = asyncio.create_task(self.grants.close_run(token))
        await asyncio.sleep(0)
        self.assertFalse(closing.done())
        release.set()
        await closing
        await asyncio.gather(invocation, return_exceptions=True)
        jobs = self.grants.ledger.jobs(self.run["id"])
        self.assertEqual(len(jobs), 1)
        self.assertIn(
            self.service.images.get_job(jobs[0])["state"], {"cancelled", "succeeded"}
        )
        self.assertFalse(self.grants.authorized(token))
        self.assertFalse(self.service.scheduler.lock.locked())

    async def test_restart_recovers_unbound_job_without_replaying_media_or_tokens(self):
        token = await self.activate()
        original_bind = self.grants.ledger.bind

        def fail_bind(*args):
            raise OSError("lost reply")

        self.grants.ledger.bind = fail_bind
        with self.assertRaises(OSError):
            await self.grants.invoke(
                token,
                "interrupted-dispatch",
                "image_generate",
                {"prompt": "one image", "width": 64, "height": 64, "steps": 1},
            )
        job = self.service.images.list_jobs()[0]
        self.assertIsNone(
            self.grants.ledger.dispatch(self.run["id"], "interrupted-dispatch")[
                "job_id"
            ]
        )
        ledger = CapabilityLedger(self.service.store.database)
        recovered = CapabilityGrants(
            ledger,
            self.grants.scheduler,
            self.grants.inference,
            self.grants.bridge,
            self.grants.extensions,
            self.grants.models,
            self.grants.generation,
        )
        try:
            self.assertEqual(ledger.jobs(self.run["id"]), [job["id"]])
            self.assertEqual(ledger.scope(self.run["id"])["state"], "interrupted")
            self.assertEqual(len(self.service.images.list_jobs()), 1)
            self.assertFalse(recovered.authorized(token))
            with self.assertRaises(RuntimeFault) as closed:
                await recovered.prepare(self.run)
            self.assertEqual(closed.exception.info.code, "CAPABILITY_SCOPE_EXPIRED")
        finally:
            self.grants.ledger.bind = original_bind
            await recovered.close()

    async def test_unused_stale_media_binding_does_not_authorize_or_resolve_model(self):
        self.run["capabilitySnapshot"]["tools"] = []
        self.run["capabilitySnapshot"]["mediaBindings"] = {
            "imageModelId": "removed-image-model"
        }
        token = await self.activate()
        self.assertEqual(
            set(self.grants.get(token).model_identities), {"builtin-fake-text"}
        )
        with self.assertRaises(RuntimeFault) as denied:
            await self.grants.invoke(
                token, "image", "image_generate", {"prompt": "blocked"}
            )
        self.assertEqual(denied.exception.info.code, "CAPABILITY_ACTION_NOT_ALLOWED")

    async def test_pending_revocation_and_active_expiry_do_not_reactivate(self):
        self.run["capabilitySnapshot"]["skills"] = [{"id": "selected-skill"}]
        bootstrap = await self.grants.prepare(self.run)
        await self.grants.revoke("selected-skill")
        with self.assertRaises(RuntimeFault):
            await self.grants.activate(bootstrap)
        self.run["id"] = "run-two"
        token = await self.activate()
        self.now += 1201
        self.assertFalse(self.grants.authorized(token))

    async def test_scope_tokens_and_private_connections_never_enter_ledger(self):
        token = await self.activate()
        persisted = " ".join(
            str(tuple(row))
            for row in self.service.store.database.connection.execute(
                "SELECT * FROM capability_scopes"
            )
        )
        self.assertNotIn(token[7:], persisted)
        self.assertNotIn("bootstrapToken", persisted)
        self.assertEqual(
            json.loads(self.grants.ledger.scope(self.run["id"])["snapshot"])[
                "snapshotDigest"
            ],
            "snapshot",
        )
