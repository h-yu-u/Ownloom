"""Opt-in real HTTP editing verification using isolated persistence and managed attachments."""

import argparse
import asyncio
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

from scripts.verify.verify_local_image import image_job, start_runtime, stop_runtime


async def upload(client: Any, path: Path) -> str:
    response = await client.post(
        f"/internal/v1/attachments?filename={path.name}", content=path.read_bytes()
    )
    response.raise_for_status()
    return str(response.json()["id"])


async def save_result(client: Any, job: dict[str, Any], path: Path) -> str:
    response = await client.get(
        f"/internal/v1/image-artifacts/{job['artifact_id']}/content"
    )
    response.raise_for_status()
    path.write_bytes(response.content)
    from PIL import Image

    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        if image.size != (512, 512):
            raise RuntimeError("Unexpected editing output dimensions")
    return hashlib.sha256(response.content).hexdigest()


async def verify(client: Any, args: argparse.Namespace) -> dict[str, Any]:
    imported = await client.post(
        "/internal/v1/models/import", json={"path": str(args.model_path)}
    )
    imported.raise_for_status()
    model = imported.json()
    if (
        not model["capabilities"]["imageEditing"]
        or not model["capabilities"]["inpainting"]
    ):
        raise RuntimeError("The complete editing checkpoint was not recognized")
    source = await upload(client, args.source)
    reference = await upload(client, args.reference)
    mask = await upload(client, args.mask)
    parameters = {
        "model_id": model["id"],
        "mode": "edit",
        "reference_ids": [source, reference],
        "prompt": "Change the teapot in image 1 to the blue color in image 2. Keep everything else unchanged.",
        "width": 512,
        "height": 512,
        "steps": 40,
        "seed": 42,
    }
    await image_job(client, dict(parameters, steps=80), cancel=True)
    edit = await image_job(client, parameters)
    edit_sha = await save_result(client, edit, args.output / "reference-edit.png")
    painted = dict(
        parameters,
        mode="inpaint",
        reference_ids=[source],
        mask_id=mask,
        prompt="Paint one large solid white five-pointed star on the front center of the red teapot. Preserve everything else.",
    )
    local = await image_job(client, painted)
    mask_sha = await save_result(client, local, args.output / "masked-edit.png")
    gallery = (await client.get("/internal/v1/image-artifacts")).json()
    if (
        len(gallery) != 2
        or gallery[0]["mask_id"] != mask
        or gallery[1]["reference_ids"] != [source, reference]
    ):
        raise RuntimeError("Editing inputs were not preserved in history")
    return {
        "model_id": model["id"],
        "cancellation": "passed",
        "reference_order": "passed",
        "artifact_ids": [edit["artifact_id"], local["artifact_id"]],
        "sha256": [edit_sha, mask_sha],
        "reference_ids": [source, reference],
        "mask_id": mask,
    }


async def verify_restart(client: Any, result: dict[str, Any]) -> None:
    for identifier, expected in zip(
        result["artifact_ids"], result["sha256"], strict=True
    ):
        response = await client.get(
            f"/internal/v1/image-artifacts/{identifier}/content"
        )
        response.raise_for_status()
        if hashlib.sha256(response.content).hexdigest() != expected:
            raise RuntimeError("Editing output changed after restart")
    for identifier in [*result["reference_ids"], result["mask_id"]]:
        response = await client.get(f"/internal/v1/attachments/{identifier}")
        response.raise_for_status()


async def run(args: argparse.Namespace) -> None:
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mlx-edit-api-") as directory:
        process, client = await start_runtime(directory, args.sidecar)
        try:
            async with client:
                result = await verify(client, args)
        finally:
            await stop_runtime(process)
        process, client = await start_runtime(directory, args.sidecar)
        try:
            async with client:
                await verify_restart(client, result)
        finally:
            await stop_runtime(process)
    result.update(restart="passed", shutdown="passed")
    (args.output / "api-result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("model-path", "source", "reference", "mask", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument(
        "--sidecar", help="Exercise the packaged Runtime instead of source"
    )
    asyncio.run(run(parser.parse_args()))
