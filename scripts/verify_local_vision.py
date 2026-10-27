"""Opt-in real VLM image input and regeneration verification in a temporary workspace."""

import argparse
import asyncio
import json
import tempfile
from pathlib import Path

from verify_local_chat import turn
from verify_local_image import start_runtime, stop_runtime


async def verify(path: str, image: Path, sidecar: str | None) -> None:
    with tempfile.TemporaryDirectory(prefix="mlx-real-vision-") as directory:
        process, client = await start_runtime(directory, sidecar)
        try:
            async with client:
                imported = await client.post(
                    "/internal/v1/models/import", json={"path": path}
                )
                imported.raise_for_status()
                model = imported.json()
                uploaded = await client.post(
                    "/internal/v1/attachments",
                    params={"filename": "verification.png"},
                    content=image.read_bytes(),
                )
                uploaded.raise_for_status()
                attachment_id = uploaded.json()["id"]
                created = await client.post(
                    "/internal/v1/conversations",
                    json={"title": "Vision QA", "model_id": model["id"]},
                )
                created.raise_for_status()
                conversation = created.json()["id"]
                reply, deltas = await turn(
                    client,
                    conversation,
                    model["id"],
                    "请用一句话描述图中的主要物体。",
                    attachment_ids=[attachment_id],
                )
                if not reply.strip():
                    raise RuntimeError("Vision output is empty")
                regenerated = await client.post(
                    f"/internal/v1/conversations/{conversation}/regenerate",
                    params={"model_id": model["id"]},
                )
                regenerated.raise_for_status()
                job_id = regenerated.json()["jobId"]
                async with asyncio.timeout(180):
                    while True:
                        job = (await client.get(f"/internal/v1/jobs/{job_id}")).json()
                        if job["state"] in {"succeeded", "failed", "cancelled"}:
                            if job["state"] != "succeeded":
                                raise RuntimeError(
                                    f"Regeneration did not succeed: {job['state']}"
                                )
                            break
                        await asyncio.sleep(0.1)
                saved = (
                    await client.get(f"/internal/v1/conversations/{conversation}")
                ).json()["messages"]
                assert (
                    len(saved) == 2
                    and saved[0]["attachments"][0]["id"] == attachment_id
                )
                assert (
                    saved[1]["content"].strip()
                    and saved[1]["parameters"]["temperature"] == 0
                )
        finally:
            await stop_runtime(process)
    print(
        json.dumps(
            {
                "model_id": model["id"],
                "vision_input": "passed",
                "stream_deltas": deltas,
                "regenerate_attachments_and_parameters": "passed",
                "reply": reply,
                "shutdown": "passed",
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--sidecar")
    arguments = parser.parse_args()
    asyncio.run(verify(arguments.model_path, arguments.image, arguments.sidecar))
