"""Interactive real-task acceptance against an isolated Coding project."""

import asyncio
import json
import shutil
import time
from pathlib import Path

import httpx

PREFIX = "/internal/v1/coding"


async def verify_task(
    client: httpx.AsyncClient, model_id: str, directory: Path, output: Path, task: str
) -> None:
    project_path = directory / "library-project"
    project_path.mkdir()
    project = await client.post(PREFIX + "/projects", json={"path": str(project_path)})
    project.raise_for_status()
    session = await client.post(
        PREFIX + f"/projects/{project.json()['id']}/sessions", json={}
    )
    session.raise_for_status()
    session_id = session.json()["id"]
    run = await client.post(
        PREFIX + f"/sessions/{session_id}/runs",
        json={
            "submissionId": "real-task-acceptance",
            "text": task,
            "modelId": model_id,
            "mode": "develop",
        },
    )
    run.raise_for_status()
    watermark = 0
    started = time.monotonic()
    try:
        while time.monotonic() - started < 1250:
            response = await client.get(PREFIX + f"/sessions/{session_id}/snapshot")
            response.raise_for_status()
            state = response.json()
            for event in state["events"]:
                if event["seq"] > watermark:
                    watermark = event["seq"]
                    if event["type"] in {
                        "assistant.message",
                        "tool.started",
                        "tool.finished",
                    }:
                        print(
                            json.dumps(
                                {
                                    "type": event["type"],
                                    "text": event["text"][:1000],
                                    "data": event["data"],
                                },
                                ensure_ascii=False,
                            ),
                            flush=True,
                        )
            output.write_text(json.dumps(state, ensure_ascii=False, indent=2))
            output.chmod(0o600)
            for approval in state["approvals"]:
                if approval["status"] == "pending":
                    print(
                        "Review approval: " + json.dumps(approval, ensure_ascii=False),
                        flush=True,
                    )
                    answer = await asyncio.to_thread(
                        input, "Allow this exact request? [y/N] "
                    )
                    decision = await client.post(
                        PREFIX + f"/approvals/{approval['id']}/resolve",
                        json={"allowed": answer.strip().lower() == "y"},
                    )
                    decision.raise_for_status()
            current = next(r for r in state["runs"] if r["id"] == run.json()["id"])
            if current["status"] in {"completed", "failed", "cancelled", "interrupted"}:
                print(json.dumps(current, ensure_ascii=False), flush=True)
                if current["status"] != "completed":
                    raise RuntimeError(f"Real task failed: {current['error']}")
                if not any(project_path.rglob("*.html")):
                    raise RuntimeError("Real task did not produce a web application")
                return
            await asyncio.sleep(1)
        raise RuntimeError("Real task timed out")
    finally:
        destination = output.with_suffix(".project")
        if destination.exists():
            raise RuntimeError(
                f"Refusing to overwrite existing evidence: {destination}"
            )
        shutil.copytree(project_path, destination)
