"""Blocking system credential I/O must not stall admission or escape mutation ownership."""

import asyncio
import json
import threading
import unittest

from mlx_studio_runtime.application.extension_gateway import ExtensionGateway
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class ControlledSecrets:
    def __init__(self, blocked):
        self.blocked = blocked
        self.entered, self.release = threading.Event(), threading.Event()
        self.values = {}
        self.writes = []
        self.blocked_once = False
        self.fail_once = False

    def wait(self, operation):
        if operation == self.blocked and not self.blocked_once:
            self.blocked_once = True
            self.entered.set()
            if not self.release.wait(3):
                raise TimeoutError("test did not release the credential store")

    def find(self, reference):
        self.wait("find")
        return self.values.get(reference)

    def resolve(self, reference):
        self.wait("resolve")
        return self.values[reference]

    def set(self, reference, value):
        self.wait("set")
        if self.fail_once:
            self.fail_once = False
            raise RuntimeFault(RuntimeErrorInfo("SECRET_STORE_UNAVAILABLE", "test"))
        self.writes.append((reference, value))
        self.values[reference] = value

    def delete(self, reference):
        self.values.pop(reference, None)


class RecordingCoding:
    def __init__(self):
        self.published = []
        self.tested = []
        self.server = {
            "id": "server",
            "revision": 1,
            "digest": "snapshot",
            "transport": {
                "type": "streamable-http",
                "secretRefs": {"Authorization": "stored"},
            },
        }

    async def call(self, method, params):
        if method == "extensions.mcp.save":
            self.published.append(params)
            return params
        if method == "extensions.mcp.inspect":
            return self.server
        if method == "extensions.mcp.test":
            self.tested.append(params)
            return {"ok": True}
        if method == "sessions.get":
            return {"projectId": "project"}
        if method == "extensions.resolve":
            return {"snapshot": {"servers": [self.server]}}
        raise AssertionError(method)


class ExtensionSecretBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def gateway(self, blocked):
        secrets, coding = ControlledSecrets(blocked), RecordingCoding()
        secrets.values["stored"] = json.dumps({"value": "test-one", "kind": "bearer"})
        return ExtensionGateway(coding, secrets), secrets, coding

    def request(self, value="test-one"):
        return {
            "mutationId": "same-mutation",
            "name": "server",
            "transport": {"type": "streamable-http", "url": "https://example.test/mcp"},
            "credential": {
                "action": "replace",
                "field": "Authorization",
                "kind": "bearer",
                "value": value,
            },
        }

    async def responsive(self, operation, secrets):
        heartbeat, observed = threading.Event(), []

        def observe():
            try:
                if secrets.entered.wait(1):
                    observed.append(heartbeat.wait(0.3))
            finally:
                secrets.release.set()

        observer = threading.Thread(target=observe)
        observer.start()
        task = asyncio.create_task(operation)
        try:
            await asyncio.sleep(0)
            heartbeat.set()
            result = await task
        finally:
            secrets.release.set()
            observer.join(timeout=1)
        self.assertEqual(observed, [True], "credential I/O blocked the event loop")
        return result

    async def test_staging_keeps_supervisor_responsive(self):
        for blocked in ("find", "set"):
            with self.subTest(blocked=blocked):
                gateway, secrets, coding = self.gateway(blocked)
                result = await self.responsive(gateway.save(self.request()), secrets)
                self.assertEqual(len(secrets.writes), 1)
                self.assertEqual(len(coding.published), 1)
                self.assertEqual(
                    result["transport"]["secretRefs"], {"Authorization": "configured"}
                )

    async def test_connection_checks_keep_supervisor_responsive(self):
        gateway, secrets, coding = self.gateway("resolve")
        await self.responsive(gateway.test("server", 1), secrets)
        self.assertEqual(
            coding.tested[0]["connectionSecrets"], {"Authorization": "Bearer test-one"}
        )

    async def test_run_secret_resolution_keeps_supervisor_responsive(self):
        gateway, secrets, _coding = self.gateway("resolve")
        result = await self.responsive(
            gateway.run_connections("session", None, "analyze"), secrets
        )
        self.assertEqual(
            result["server"]["values"], {"Authorization": "Bearer test-one"}
        )

    async def cancel_with_retry(self, value, fail=False):
        gateway, secrets, coding = self.gateway("set")
        secrets.fail_once = fail
        # The fallback releases old synchronous implementations, making red tests bounded.
        fallback = threading.Timer(1, secrets.release.set)
        fallback.start()
        first = asyncio.create_task(gateway.save(self.request()))
        second = None
        try:
            entered = await asyncio.to_thread(secrets.entered.wait, 2)
            self.assertTrue(entered)
            first.cancel()
            await asyncio.sleep(0)
            retained_after_cancel = not first.done()
            second = asyncio.create_task(gateway.save(self.request(value)))
            await asyncio.sleep(0)
            first.cancel()
            await asyncio.sleep(0)
            retained_after_repeat = not first.done() and not second.done()
        finally:
            secrets.release.set()
            fallback.cancel()
            fallback.join(timeout=1)
            results = await asyncio.gather(
                *([first, second] if second else [first]), return_exceptions=True
            )
        self.assertTrue(
            retained_after_cancel, "save released ownership before its write settled"
        )
        self.assertTrue(
            retained_after_repeat, "repeated cancellation released mutation ownership"
        )
        self.assertIsInstance(results[0], asyncio.CancelledError)
        return results[1], secrets, coding

    async def test_cancelled_write_finishes_before_conflicting_retry(self):
        result, secrets, coding = await self.cancel_with_retry("test-two")
        self.assertIsInstance(result, RuntimeFault)
        self.assertEqual(result.info.code, "IDEMPOTENCY_CONFLICT")
        self.assertEqual(len(secrets.writes), 1)
        self.assertEqual(json.loads(secrets.writes[0][1])["value"], "test-one")
        self.assertEqual(coding.published, [])

    async def test_identical_retry_reuses_cancelled_staged_write(self):
        result, secrets, coding = await self.cancel_with_retry("test-one")
        self.assertIsInstance(result, dict)
        self.assertEqual(len(secrets.writes), 1)
        self.assertEqual(len(coding.published), 1)

    async def test_cancelled_failed_write_releases_lock_for_retry(self):
        result, secrets, coding = await self.cancel_with_retry("test-one", fail=True)
        self.assertIsInstance(result, dict)
        self.assertEqual(len(secrets.writes), 1)
        self.assertEqual(len(coding.published), 1)

    async def test_store_failure_is_reported_without_publishing(self):
        gateway, secrets, coding = self.gateway(None)
        secrets.fail_once = True
        with self.assertRaises(RuntimeFault) as failure:
            await gateway.save(self.request())
        self.assertEqual(failure.exception.info.code, "SECRET_STORE_UNAVAILABLE")
        self.assertEqual(coding.published, [])
        await gateway.save(self.request())
        self.assertEqual(len(coding.published), 1)
