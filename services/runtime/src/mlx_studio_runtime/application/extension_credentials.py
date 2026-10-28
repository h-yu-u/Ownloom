"""MCP credential I/O keeps an in-flight write owned until the system store settles."""

import asyncio
import hashlib
import json
from typing import Any

from mlx_studio_runtime.application.secret_ports import SecretStorePort
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


async def stage_credential(
    store: SecretStorePort, payload: dict[str, Any], credential: dict[str, Any]
) -> str:
    public_intent = {
        **payload,
        "credential": {key: value for key, value in credential.items() if key != "value"},
    }
    intent = hashlib.sha256(json.dumps(public_intent, sort_keys=True).encode()).hexdigest()
    reference = (
        "mcp-"
        + hashlib.sha256((payload["mutationId"] + ":" + credential["field"]).encode()).hexdigest()
    )
    staged = json.dumps(
        {"intent": intent, "value": credential["value"], "kind": credential["kind"]}, sort_keys=True
    )
    await _write_staged(store, reference, staged)
    return reference


async def _write_staged(store: SecretStorePort, reference: str, staged: str) -> None:
    operation = asyncio.get_running_loop().run_in_executor(None, _stage, store, reference, staged)
    try:
        await asyncio.shield(operation)
    except asyncio.CancelledError:
        # The OS write cannot be cancelled. Retain the caller's save lock until it finishes,
        # including repeated cancellation, so a retry cannot race its find/set pair.
        while not operation.done():
            try:
                await asyncio.shield(operation)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if not operation.cancelled():
            operation.exception()
        raise


def _stage(store: SecretStorePort, reference: str, staged: str) -> None:
    existing = store.find(reference)
    if existing is not None and existing != staged:
        raise RuntimeFault(RuntimeErrorInfo("IDEMPOTENCY_CONFLICT", "请求编号已用于其他凭据"))
    if existing is None:
        store.set(reference, staged)


def resolve_connection(store: SecretStorePort, references: dict[str, str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for field, reference in references.items():
        saved = json.loads(store.resolve(reference))
        values[field] = ("Bearer " if saved["kind"] == "bearer" else "") + saved["value"]
    return values
