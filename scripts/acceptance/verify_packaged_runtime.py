"""Exercise the real packaged sidecar against a temporary FakeEngine workspace."""

import argparse
import asyncio
import json
import tempfile
from pathlib import Path

from scripts.verify.verification_models import seed_fake_text
from scripts.verify.verify_local_chat import turn
from scripts.verify.verify_local_image import start_runtime, stop_runtime


async def verify(sidecar: str) -> None:
    with tempfile.TemporaryDirectory(prefix="mlx-sidecar-") as directory:
        seed_fake_text(Path(directory) / "app.db")
        process, client = await start_runtime(directory, str(Path(sidecar).resolve()))
        try:
            async with client:
                models = (await client.get("/internal/v1/models")).json()
                assert any(model["id"] == "builtin-fake-text" for model in models)
                initial_metrics = (
                    await client.get("/internal/v1/runtime/metrics")
                ).json()
                assert initial_metrics["worker_memory_bytes"] == 0
                assert initial_metrics["system_memory_total_bytes"] > 0
                created = await client.post(
                    "/internal/v1/conversations",
                    json={"title": "Packaged QA", "model_id": "builtin-fake-text"},
                )
                created.raise_for_status()
                conversation = created.json()["id"]
                reply, _ = await turn(
                    client, conversation, "builtin-fake-text", "packaged verification"
                )
                assert reply.strip()
                live_metrics = (await client.get("/internal/v1/runtime/metrics")).json()
                assert live_metrics["worker_memory_bytes"] > 0
                assert 0 <= live_metrics["system_memory_used_percent"] <= 100
                assert live_metrics["system_memory_total_bytes"] == (
                    live_metrics["system_memory_used_bytes"]
                    + live_metrics["system_memory_available_bytes"]
                )
                await turn(
                    client,
                    conversation,
                    "builtin-fake-text",
                    "cancel verification",
                    cancel=True,
                )
                restarted = await client.post("/internal/v1/runtime/restart-worker")
                restarted.raise_for_status()
                await turn(client, conversation, "builtin-fake-text", "after restart")
                diagnostics = await client.get(
                    "/internal/v1/runtime/diagnostics/bundle"
                )
                diagnostics.raise_for_status()
                assert diagnostics.content[:2] == b"PK"
                unloaded = await client.post(
                    "/internal/v1/models/builtin-fake-text/unload"
                )
                unloaded.raise_for_status()
                final_metrics = (
                    await client.get("/internal/v1/runtime/metrics")
                ).json()
                assert final_metrics["worker_memory_bytes"] == 0
        finally:
            await stop_runtime(process)
        process, client = await start_runtime(directory, str(Path(sidecar).resolve()))
        try:
            async with client:
                saved = await client.get(f"/internal/v1/conversations/{conversation}")
                saved.raise_for_status()
                assert len(saved.json()["messages"]) >= 5
        finally:
            await stop_runtime(process)
    print(
        json.dumps(
            {
                "packaged_fake_engine": "passed",
                "live_system_and_worker_memory": "passed",
                "chat": "passed",
                "cancel": "passed",
                "worker_restart": "passed",
                "runtime_restart_persistence": "passed",
                "shutdown": "passed",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar", required=True)
    asyncio.run(verify(parser.parse_args().sidecar))
