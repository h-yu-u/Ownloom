"""Prepare and register authorization before committing a run to the Host queue."""

from typing import Any

from mlx_studio_runtime.application.capability_grants import CapabilityGrants
from mlx_studio_runtime.application.coding_model_requests import CodingModelRequests
from mlx_studio_runtime.application.extension_gateway import ExtensionGateway


class CodingRunSubmission:
    def __init__(
        self, requests: CodingModelRequests, extensions: ExtensionGateway, grants: CapabilityGrants
    ) -> None:
        self.requests, self.extensions, self.grants = requests, extensions, grants

    async def submit(
        self, params: dict[str, object], base_url: str, model_id: str, agent: bool = False
    ) -> Any:
        with self.grants.references.preparing((model_id,)):
            return await self._submit(params, base_url, model_id, agent)

    async def _submit(
        self, params: dict[str, object], base_url: str, model_id: str, agent: bool
    ) -> Any:
        run = await self.requests.call(
            "agent.runs.prepare" if agent else "runs.prepare", params, base_url, model_id
        )
        if run["status"] in {"completed", "cancelled", "failed", "interrupted"}:
            return run
        connections = {
            server["id"]: {
                "revision": server["revision"],
                "digest": server["digest"],
                "values": await self.extensions.connection(server),
            }
            for server in run["capabilitySnapshot"]["servers"]
        }
        bootstrap = await self.grants.prepare(run)
        committed = await self.extensions.coding.call(
            "agent.runs.commit" if agent else "runs.commit",
            {
                "id": run["id"],
                "bootstrapToken": bootstrap,
                "capabilityUrl": base_url.rstrip("/") + "/internal/v1/agent-capabilities",
                "connectionSecrets": connections,
            },
        )

        if committed["status"] in {"completed", "cancelled", "failed", "interrupted"}:
            await self.grants.cancel_id(run["id"])
        return committed
