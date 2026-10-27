"""Thin Host forwarding and Keychain injection; Node alone owns the extension catalog."""

import asyncio
import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from mlx_studio_runtime.application.coding_gateway import CodingGateway
from mlx_studio_runtime.application.secret_ports import SecretStorePort
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.generated.coding_rpc import RpcMethod


def public_projection(value: Any) -> Any:
    if isinstance(value, list):
        return [public_projection(item) for item in value]
    if isinstance(value, dict):
        return {
            key: {field: "configured" for field in item}
            if value.get("type") in ("stdio", "streamable-http")
            and key == "secretRefs"
            and isinstance(item, dict)
            else public_projection(item)
            for key, item in value.items()
        }
    return value


class ExtensionGateway:
    def __init__(self, coding: CodingGateway, secrets: SecretStorePort) -> None:
        self.coding, self.secrets = coding, secrets
        self.lock = asyncio.Lock()
        self.revoke_lock = asyncio.Lock()
        self.text_jobs: dict[str, dict[str, Any]] = {}
        self.cancel_job: Callable[[str], Awaitable[object]] | None = None
        self.revoking: set[str] = set()
        self.revoke_scopes: Callable[[str], Awaitable[None]] | None = None

    async def call(self, method: RpcMethod, params: dict[str, object]) -> Any:
        if method != "extensions.revoke":
            return public_projection(await self.coding.call(method, params))
        async with self.revoke_lock:
            return await self._revoke(method, params)

    async def _revoke(self, method: RpcMethod, params: dict[str, object]) -> Any:
        prior = await self.coding.call("extensions.mutations.get", {"id": params["mutationId"]})
        if prior is not None:
            return public_projection(await self.coding.call(method, params))
        target = str(params["targetId"])
        self.revoking.add(target)
        try:
            if self.revoke_scopes:
                await self.revoke_scopes(target)
            result = await self.coding.call(method, params)
            jobs = [
                identifier
                for identifier, snapshot in self.text_jobs.items()
                if any(skill["id"] == target for skill in snapshot["skills"])
            ]
            if self.cancel_job:
                for identifier in jobs:
                    await self.cancel_job(identifier)
            return public_projection(result)
        finally:
            self.revoking.discard(target)

    async def save(self, body: dict[str, Any]) -> Any:
        async with self.lock:
            return await self._save(body)

    async def _save(self, body: dict[str, Any]) -> Any:
        credential = body.get("credential", {"action": "keep"})
        payload = {key: value for key, value in body.items() if key != "credential"}
        transport = dict(payload["transport"])
        refs: dict[str, str] = {}
        previous: dict[str, Any] | None = None
        if body.get("id"):
            previous = await self.coding.call(
                "extensions.mcp.inspect", {"id": body["id"], "revision": body["expectedRevision"]}
            )
            if previous is not None:
                refs = dict(previous["transport"]["secretRefs"])
        # A transport change cannot carry credentials across to a new target implicitly.
        if previous is not None and (
            previous["transport"]["type"] != transport["type"]
            or previous["transport"].get("url") != transport.get("url")
            or previous["transport"].get("executable") != transport.get("executable")
        ):
            refs = {}
        action, field = credential["action"], credential.get("field", "")
        if action != "keep":
            pattern = (
                r"[A-Za-z_][A-Za-z0-9_]{0,127}"
                if transport["type"] == "stdio"
                else r"[A-Za-z][A-Za-z0-9-]{0,127}"
            )
            if not re.fullmatch(pattern, field) or field.lower() in {
                "host",
                "content-length",
                "connection",
            }:
                raise RuntimeFault(RuntimeErrorInfo("INVALID_CREDENTIAL_FIELD", "凭据字段无效"))
        if action == "clear":
            refs.pop(field, None)
        elif action == "replace":
            if (transport["type"] == "stdio") != (credential["kind"] == "env"):
                raise RuntimeFault(
                    RuntimeErrorInfo("INVALID_CREDENTIAL_FIELD", "凭据类型与连接方式不匹配")
                )
            public_intent = {
                **payload,
                "credential": {k: v for k, v in credential.items() if k != "value"},
            }
            intent = hashlib.sha256(json.dumps(public_intent, sort_keys=True).encode()).hexdigest()
            reference = (
                "mcp-" + hashlib.sha256((body["mutationId"] + ":" + field).encode()).hexdigest()
            )
            staged = json.dumps(
                {"intent": intent, "value": credential["value"], "kind": credential["kind"]},
                sort_keys=True,
            )
            existing = self.secrets.find(reference)
            if existing is not None and existing != staged:
                raise RuntimeFault(
                    RuntimeErrorInfo("IDEMPOTENCY_CONFLICT", "请求编号已用于其他凭据")
                )
            if existing is None:
                self.secrets.set(reference, staged)
            refs[field] = reference
        public_credential = {key: value for key, value in credential.items() if key != "value"}
        payload["credentialIntent"] = hashlib.sha256(
            json.dumps(public_credential, sort_keys=True).encode()
        ).hexdigest()
        transport["secretRefs"] = refs
        payload["transport"] = transport
        return await self.call("extensions.mcp.save", payload)

    def connection(self, server: dict[str, Any]) -> dict[str, str]:
        values: dict[str, str] = {}
        for field, reference in server["transport"]["secretRefs"].items():
            saved = json.loads(self.secrets.resolve(reference))
            values[field] = ("Bearer " if saved["kind"] == "bearer" else "") + saved["value"]
        return values

    async def test(self, identifier: str, revision: int) -> Any:
        server = await self.coding.call(
            "extensions.mcp.inspect", {"id": identifier, "revision": revision}
        )
        return await self.call(
            "extensions.mcp.test",
            {
                "id": identifier,
                "configRevision": revision,
                "connectionSecrets": self.connection(server),
            },
        )

    async def run_connections(
        self, session_id: str, selection: dict[str, Any] | None, mode: str
    ) -> dict[str, Any]:
        session = await self.coding.call("sessions.get", {"id": session_id})
        params: dict[str, object] = {
            "scope": {"workspace": "coding", "kind": "project", "scopeId": session["projectId"]},
            "mode": mode,
        }
        if selection is not None:
            params["selection"] = selection
        result = await self.coding.call("extensions.resolve", params)
        return {
            server["id"]: {
                "revision": server["revision"],
                "digest": server["digest"],
                "values": self.connection(server),
            }
            for server in result["snapshot"]["servers"]
        }

    async def text_skills(
        self, scope: dict[str, Any], selection: dict[str, Any] | None
    ) -> dict[str, Any]:
        if selection is not None and not selection.get("skillIds") and not selection.get("toolIds"):
            snapshot = {
                "schemaVersion": 1,
                "workspace": scope["workspace"],
                "mode": "analyze",
                "catalogRevision": 0,
                "policyEpoch": 0,
                "skills": [],
                "servers": [],
                "tools": [],
            }
            snapshot["snapshotDigest"] = "empty-capability-v1"
            return {"snapshot": snapshot, "loaded": []}
        params: dict[str, object] = {"scope": scope}
        if selection is not None:
            params["selection"] = selection
        resolved = await self.coding.call("extensions.resolve", params)
        snapshot = resolved["snapshot"]
        loaded: list[dict[str, Any]] = []
        for skill in snapshot["skills"]:
            inspected = await self.coding.call(
                "extensions.skills.inspect", {"id": skill["id"], "revision": skill["revision"]}
            )
            loaded.append(
                {
                    "id": skill["id"],
                    "revision": skill["revision"],
                    "digest": skill["digest"],
                    "body": inspected["body"],
                }
            )
        return {"snapshot": snapshot, "loaded": loaded}

    async def validate_text(self, snapshot: dict[str, Any]) -> None:
        if snapshot.get("snapshotDigest") == "empty-capability-v1" and not any(
            snapshot.get(key) for key in ("skills", "servers", "tools")
        ):
            return
        if any(skill["id"] in self.revoking for skill in snapshot["skills"] + snapshot["servers"]):
            raise RuntimeFault(RuntimeErrorInfo("CAPABILITY_REVOKED", "技能授权已撤销"))
        await self.coding.call("extensions.check", {"snapshot": snapshot})

    def bind_text(self, job_id: str, snapshot: dict[str, Any]) -> None:
        if any(skill["id"] in self.revoking for skill in snapshot["skills"] + snapshot["servers"]):
            raise RuntimeFault(RuntimeErrorInfo("CAPABILITY_REVOKED", "技能授权已撤销"))
        self.text_jobs[job_id] = snapshot

    def release_text(self, job_id: str) -> None:
        self.text_jobs.pop(job_id, None)
