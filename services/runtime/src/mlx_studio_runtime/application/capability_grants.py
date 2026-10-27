"""Queue-time bootstrap, run-time activation and serialized child-Job admission."""

import asyncio
import hashlib
import json
import secrets
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from mlx_studio_runtime.application.builtin_tool_bridge import BuiltinToolBridge
from mlx_studio_runtime.application.capability_ports import CapabilityLedgerPort
from mlx_studio_runtime.application.extension_gateway import ExtensionGateway
from mlx_studio_runtime.application.inference_service import InferenceService
from mlx_studio_runtime.application.ports import JobAdmission
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.models import ModelManifest


def fault(code: str) -> RuntimeFault:
    return RuntimeFault(RuntimeErrorInfo(code, "运行能力授权无效或已停止"))


@dataclass
class RunGrant:
    run_id: str
    snapshot: dict[str, Any]
    model_id: str
    generation: str
    bootstrap: str
    expires: float
    model_identities: dict[str, str] = field(default_factory=dict)
    voice_version: int | None = None
    token: str | None = None
    accepting: bool = True
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class CapabilityGrants:
    def __init__(
        self,
        ledger: CapabilityLedgerPort,
        scheduler: JobAdmission,
        inference: InferenceService,
        bridge: BuiltinToolBridge,
        extensions: ExtensionGateway,
        models: dict[str, ModelManifest],
        generation: Callable[[], str],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.ledger, self.scheduler, self.inference, self.bridge = (
            ledger,
            scheduler,
            inference,
            bridge,
        )
        self.extensions, self.models, self.generation, self.clock = (
            extensions,
            models,
            generation,
            clock,
        )
        self.grants: dict[str, RunGrant] = {}
        self.pending: dict[str, RunGrant] = {}
        self.tokens: dict[str, RunGrant] = {}
        self.lock = asyncio.Lock()
        self.reaper: asyncio.Task[None] | None = None
        self.closing = False
        for dispatch in ledger.unbound():
            if dispatch["action"] == "inference":
                continue
            submission = hashlib.sha256(
                (dispatch["run_id"] + ":" + dispatch["invocation_id"]).encode()
            ).hexdigest()
            job_id = bridge.recover(dispatch["action"], submission)
            if job_id:
                ledger.bind(dispatch["run_id"], dispatch["invocation_id"], job_id)

    async def prepare(self, run: dict[str, Any]) -> str:
        async with self.lock:
            snapshot = run["capabilitySnapshot"]
            await self.extensions.validate_text(snapshot)
            self._validate_models(snapshot, run["modelId"])
            prior = self.grants.get(run["id"])
            if prior:
                if prior.snapshot["snapshotDigest"] != snapshot["snapshotDigest"]:
                    raise fault("IDEMPOTENCY_CONFLICT")
                self._check(prior, active=False)
                return prior.bootstrap
            if self.ledger.scope(run["id"]):
                raise fault("CAPABILITY_SCOPE_EXPIRED")
            grant = RunGrant(
                run["id"],
                snapshot,
                run["modelId"],
                self.generation(),
                secrets.token_urlsafe(32),
                self.clock() + 86400,
            )
            model_ids = {grant.model_id}
            selected = {
                tool["originalName"] for tool in snapshot["tools"] if tool["serverId"] == "builtin"
            }
            for action, key in [
                ("image_generate", "imageModelId"),
                ("speech_generate", "speechModelId"),
            ]:
                if action in selected:
                    model_ids.add(snapshot["mediaBindings"][key])
            grant.model_identities = {
                model_id: json.dumps(self.models[model_id].to_dict(), sort_keys=True)
                for model_id in model_ids
            }
            bindings = snapshot.get("mediaBindings", {})
            if (
                "speech_generate" in selected
                and bindings.get("speechMode") == "clone"
                and bindings.get("voiceId")
            ):
                voice = self.bridge.speech.voices.get(bindings["voiceId"])
                grant.voice_version = int(voice["version"])
            self.ledger.create(
                run["id"],
                snapshot["snapshotDigest"],
                {
                    **snapshot,
                    "authorizedModels": grant.model_identities,
                    "voiceVersion": grant.voice_version,
                },
            )
            self.grants[grant.run_id] = grant
            self.pending[grant.bootstrap] = grant
            if not self.reaper or self.reaper.done():
                self.reaper = asyncio.create_task(self._reap())
            return grant.bootstrap

    def _validate_models(self, snapshot: dict[str, Any], model_id: str) -> None:
        if model_id not in self.models or "text" not in self.models[model_id].output_modalities:
            raise fault("MODEL_NOT_FOUND")
        bindings = snapshot.get("mediaBindings", {})
        for tool in snapshot["tools"]:
            if tool["serverId"] != "builtin":
                continue
            if snapshot["workspace"] == "coding" and snapshot.get("mode", "develop") != "develop":
                raise fault("READ_ONLY_MODE")
            field_name, modality = (
                ("imageModelId", "image")
                if tool["originalName"] == "image_generate"
                else ("speechModelId", "audio")
            )
            model = self.models.get(bindings.get(field_name, ""))
            if not model or modality not in model.output_modalities:
                raise fault("CAPABILITY_MODEL_REQUIRED")
            if modality == "audio":
                from mlx_studio_runtime.domain.speech import SpeechParameters, validate_speech

                validate_speech(
                    SpeechParameters(
                        model.id,
                        bindings["speechMode"],
                        "check",
                        speaker=bindings.get("speaker"),
                        voice_id=bindings.get("voiceId"),
                    ),
                    model.speech,
                )
                if bindings["speechMode"] == "clone":
                    voice = self.bridge.speech.voices.get(bindings["voiceId"])
                    if not voice["consent"] or not str(voice["reference_text"]).strip():
                        raise fault("VOICE_REFERENCE_INVALID")
                    self.bridge.speech.voices.content(str(voice["reference_asset_id"]))

    def _validate_identities(self, grant: RunGrant) -> None:
        for identifier, identity in grant.model_identities.items():
            model = self.models.get(identifier)
            if model is None or json.dumps(model.to_dict(), sort_keys=True) != identity:
                raise fault("CAPABILITY_MODEL_CHANGED")
        if grant.voice_version is not None:
            voice_id = grant.snapshot["mediaBindings"]["voiceId"]
            if self.bridge.speech.voices.get(voice_id)["version"] != grant.voice_version:
                raise fault("CAPABILITY_INPUT_CHANGED")

    async def activate(self, bootstrap: str) -> dict[str, str]:
        grant = self.pending.get(bootstrap)
        if not grant:
            raise fault("CAPABILITY_SCOPE_EXPIRED")
        async with grant.lock:
            self._check(grant, active=False)
            await self.extensions.validate_text(grant.snapshot)
            self._validate_models(grant.snapshot, grant.model_id)
            self._validate_identities(grant)
            if not grant.token:
                grant.token = secrets.token_urlsafe(32)
                grant.expires = self.clock() + 1200
                self.tokens[grant.token] = grant
                self.ledger.state(grant.run_id, "active")
            return {"token": grant.token, "runId": grant.run_id}

    def authorized(self, authorization: str | None) -> bool:
        try:
            self.get(authorization)
            return True
        except RuntimeFault:
            return False

    def get(self, authorization: str | None) -> RunGrant:
        grant = (
            self.tokens.get(authorization[7:])
            if authorization and authorization.startswith("Bearer ")
            else None
        )
        if not grant:
            raise fault("CAPABILITY_SCOPE_EXPIRED")
        self._check(grant)
        return grant

    def _check(self, grant: RunGrant, active: bool = True) -> None:
        if not grant.accepting or self.closing:
            raise fault("CAPABILITY_REVOKED")
        if (
            self.clock() >= grant.expires
            or self.generation() != grant.generation
            or (active and not grant.token)
        ):
            raise fault("CAPABILITY_SCOPE_EXPIRED")

    def _reserve(
        self, run_id: str, invocation: str, action: str, intent: str, plan: dict[str, Any]
    ) -> None:
        try:
            self.ledger.reserve(run_id, invocation, action, intent, plan)
        except ValueError as error:
            raise fault(str(error)) from error

    async def complete(
        self,
        authorization: str,
        request: dict[str, Any],
        on_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        grant = self.get(authorization)
        async with grant.lock:
            self._check(grant)
            await self.extensions.validate_text(grant.snapshot)
            self._validate_identities(grant)
            if request["model"] != grant.model_id:
                raise fault("CAPABILITY_MODEL_NOT_ALLOWED")
            declared = {tool["function"]["name"] for tool in request.get("tools", [])}
            allowed = {tool["modelName"] for tool in grant.snapshot["tools"]}
            if grant.snapshot["workspace"] == "coding":
                allowed.update({"read", "list", "search", "git_status"})
                # File mutation is checked again by Node's actual execute policy.
                if grant.snapshot.get("mode") == "develop":
                    allowed.update({"write", "edit", "run_command"})
            if grant.snapshot["skills"]:
                allowed.add("read_skill")
            if declared - allowed:
                raise fault("CAPABILITY_ACTION_NOT_ALLOWED")
            invocation = "text-" + uuid.uuid4().hex
            self._reserve(grant.run_id, invocation, "inference", "text", {})
            prepared = await self.inference.admit(
                request, lambda job: self.ledger.bind(grant.run_id, invocation, job.id), on_event
            )
        result = await self.inference.wait(prepared)
        self._check(grant)
        return result

    async def invoke(
        self, authorization: str, invocation: str, action: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        grant = self.get(authorization)
        intent = hashlib.sha256(
            json.dumps({"action": action, "args": args}, sort_keys=True).encode()
        ).hexdigest()
        async with grant.lock:
            self._check(grant)
            await self.extensions.validate_text(grant.snapshot)
            self._validate_identities(grant)
            if not any(
                tool["serverId"] == "builtin" and tool["originalName"] == action
                for tool in grant.snapshot["tools"]
            ):
                raise fault("CAPABILITY_ACTION_NOT_ALLOWED")
            dispatch = self.ledger.dispatch(grant.run_id, invocation)
            submission = hashlib.sha256((grant.run_id + ":" + invocation).encode()).hexdigest()
            if dispatch and dispatch["intent"] != intent:
                raise fault("IDEMPOTENCY_CONFLICT")
            if not dispatch:
                plan = self.bridge.plan(action, args, grant.snapshot.get("mediaBindings", {}))
                self._reserve(grant.run_id, invocation, action, intent, plan)
                dispatch = self.ledger.dispatch(grant.run_id, invocation)
            assert dispatch is not None
            if dispatch["outcome"] in {"rejected", "interrupted"}:
                raise fault("CAPABILITY_INVOCATION_CLOSED")
            job_id = dispatch["job_id"] or self.bridge.recover(action, submission)
            if not job_id:
                try:
                    job_id = await self.bridge.create(
                        action, json.loads(dispatch["request_json"]), submission
                    )
                except (RuntimeFault, ValueError):
                    recovered = self.bridge.recover(action, submission)
                    if recovered:
                        self.ledger.bind(grant.run_id, invocation, recovered)
                    else:
                        self.ledger.rejected(grant.run_id, invocation)
                    raise
            self.ledger.bind(grant.run_id, invocation, job_id)
        result = await self.bridge.wait(action, job_id)
        self._check(grant)
        return result

    async def cancel_id(self, run_id: str) -> None:
        grant = self.grants.get(run_id)
        if grant:
            await self._close(grant)

    async def close_run(self, authorization: str) -> None:
        grant = self.tokens.get(authorization.removeprefix("Bearer ")) or self.pending.get(
            authorization.removeprefix("Bearer ")
        )
        if grant:
            await self._close(grant)

    async def _close(self, grant: RunGrant) -> None:
        async with grant.lock:
            grant.accepting = False
            self.ledger.state(grant.run_id, "closing")
            for dispatch in self.ledger.dispatches(grant.run_id):
                if dispatch["job_id"] is None and dispatch["action"] != "inference":
                    submission = hashlib.sha256(
                        (grant.run_id + ":" + dispatch["invocation_id"]).encode()
                    ).hexdigest()
                    recovered = self.bridge.recover(dispatch["action"], submission)
                    if recovered:
                        self.ledger.bind(grant.run_id, dispatch["invocation_id"], recovered)
                    elif dispatch["outcome"] == "reserved":
                        self.ledger.rejected(grant.run_id, dispatch["invocation_id"])
            jobs = self.ledger.jobs(grant.run_id)
        for job_id in jobs:
            await self.scheduler.cancel(job_id)
        self.ledger.state(grant.run_id, "closed")
        self.grants.pop(grant.run_id, None)
        self.pending.pop(grant.bootstrap, None)
        if grant.token:
            self.tokens.pop(grant.token, None)

    async def revoke(self, target: str) -> None:
        async with self.lock:
            affected = [
                grant
                for grant in self.grants.values()
                if any(
                    item["id"] == target
                    for item in grant.snapshot["skills"] + grant.snapshot["servers"]
                )
            ]
            for grant in affected:
                await self._close(grant)

    async def _reap(self) -> None:
        while self.grants and not self.closing:
            await asyncio.sleep(1)
            for grant in tuple(self.grants.values()):
                if self.clock() >= grant.expires or self.generation() != grant.generation:
                    await self._close(grant)

    async def close(self) -> None:
        self.closing = True
        if self.reaper:
            self.reaper.cancel()
            await asyncio.gather(self.reaper, return_exceptions=True)
        for grant in tuple(self.grants.values()):
            await self._close(grant)
