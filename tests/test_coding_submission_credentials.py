"""Resolve MCP secrets before creating grants or crossing the Host RPC boundary."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.drafts import DraftSettings
from mlx_studio_runtime.domain.errors import RuntimeFault
from runtime_fixtures import create_test_runtime

ROOT = Path(__file__).parents[1]


class CodingSubmissionCredentialsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        store = SQLiteRepositories(Path(self.temp.name) / "app.db")
        self.service = create_test_runtime(store, ROOT / "services/runtime/src")
        self.grants = self.service.capability_grants
        self.grants.generation = lambda: "test-host"
        self.service.extensions.validate_text = AsyncMock()
        self.service.extensions.secrets = Mock()
        self.service.extensions.secrets.resolve.return_value = json.dumps(
            {"kind": "bearer", "value": "synthetic-test-token"}
        )
        self.run = {
            "id": "run-one",
            "sessionId": "session-one",
            "modelId": "builtin-fake-text",
            "status": "starting",
            "capabilitySnapshot": {
                "snapshotDigest": "snapshot",
                "workspace": "coding",
                "mode": "develop",
                "skills": [],
                "tools": [],
                "servers": [
                    {
                        "id": "test-mcp",
                        "revision": 2,
                        "digest": "test-digest",
                        "transport": {
                            "secretRefs": {"Authorization": "test-reference"}
                        },
                    }
                ],
            },
        }
        self.service.coding_requests.call = AsyncMock(return_value=self.run)
        self.commits = []

        async def send(method, params):
            self.commits.append((method, json.loads(json.dumps(params))))
            return self.run

        self.service.extensions.coding.request = AsyncMock(side_effect=send)

    async def asyncTearDown(self):
        await self.service.close()
        self.temp.cleanup()

    async def submit(self, agent=False):
        return await self.service.coding_submissions.submit(
            {}, "http://127.0.0.1:1234", self.run["modelId"], agent
        )

    async def test_coding_and_agent_commit_only_resolved_json_credentials(self):
        for agent in (False, True):
            self.run["id"] = f"run-{agent}"
            self.run["capabilitySnapshot"]["workspace"] = "chat" if agent else "coding"
            await self.submit(agent)
            method, params = self.commits[-1]
            self.assertEqual(method, "agent.runs.commit" if agent else "runs.commit")
            self.assertEqual(
                params["connectionSecrets"],
                {
                    "test-mcp": {
                        "revision": 2,
                        "digest": "test-digest",
                        "values": {"Authorization": "Bearer synthetic-test-token"},
                    }
                },
            )
            self.assertNotIn(
                "synthetic-test-token",
                self.grants.ledger.scope(self.run["id"])["snapshot"],
            )
            await self.grants.cancel_id(self.run["id"])
        self.assertEqual(self.service.extensions.secrets.resolve.call_count, 2)

    async def test_secret_read_failure_does_not_create_a_grant_or_block_model_settings(
        self,
    ):
        self.service.extensions.secrets.resolve.side_effect = ValueError(
            "secret unavailable"
        )
        with self.assertRaisesRegex(ValueError, "secret unavailable"):
            await self.submit()
        self.service.extensions.coding.request.assert_not_awaited()
        self.assertIsNone(self.grants.ledger.scope(self.run["id"]))
        self.assertFalse(self.grants.grants)
        await self.service.acceleration.configure_draft(
            self.run["modelId"], DraftSettings()
        )

    async def test_unknown_commit_outcome_keeps_reference_until_explicit_close(self):
        self.service.extensions.coding.request.side_effect = RuntimeError("reply lost")
        with self.assertRaisesRegex(RuntimeError, "reply lost"):
            await self.submit()
        with self.assertRaises(RuntimeFault) as busy:
            await self.service.acceleration.configure_draft(
                self.run["modelId"], DraftSettings()
            )
        self.assertEqual(busy.exception.info.code, "MODEL_IN_USE")
        await self.grants.cancel_id(self.run["id"])
        await self.service.acceleration.configure_draft(
            self.run["modelId"], DraftSettings()
        )
