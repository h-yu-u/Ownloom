"""Gate a built .app using its actual sidecar/Node resources, never a placeholder."""

import argparse
import asyncio
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from scripts.verify.verify_local_chat import verify as verify_chat
from scripts.verify.verify_local_image import (
    generate_and_check,
    start_runtime,
    stop_runtime,
)

ROOT = Path(__file__).resolve().parents[2]


async def run_script(name: str, *arguments: str) -> None:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        name,
        *arguments,
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT / "services/runtime/src")},
    )
    if await process.wait() != 0:
        raise RuntimeError(f"Release acceptance failed: {name}")


async def verify(args: argparse.Namespace) -> None:
    app = args.app.resolve()
    sidecar = app / "Contents/MacOS/mlx-studio-runtime"
    host = app / "Contents/Resources/coding-agent"
    if not sidecar.is_file() or not (host / "bin/node").is_file():
        raise RuntimeError("Final app resources are missing")
    if args.fake_only and any(
        [args.text_model, args.image_model, args.preset_model, args.clone_model]
    ):
        raise ValueError("Do not mix --fake-only with real model arguments")
    if not args.fake_only and not all(
        [args.text_model, args.image_model, args.preset_model, args.clone_model]
    ):
        raise ValueError("Full release acceptance requires all four local model paths")
    args.output.mkdir(parents=True, exist_ok=True)
    with sidecar.open("rb") as stream:
        sidecar_digest = hashlib.file_digest(stream, "sha256").hexdigest()
    report = {
        "app": str(app),
        "sidecar_sha256": sidecar_digest,
        "profile": "fake-only" if args.fake_only else "real-models",
        "checks": {},
        "unverified": [
            "native WebView playback/export",
            "Developer ID/notarization",
            "clean machine",
        ],
    }
    os.environ["MLX_STUDIO_CODING_RESOURCES"] = str(host)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    try:
        signature = await asyncio.create_subprocess_exec(
            "codesign", "--verify", "--deep", "--strict", str(app)
        )
        if await signature.wait() != 0:
            raise RuntimeError("Bundle signature verification failed")
        report["checks"]["bundle_signature_integrity"] = "passed"
        await run_script(
            "scripts.acceptance.verify_packaged_runtime", "--sidecar", str(sidecar)
        )
        report["checks"]["packaged_fake_runtime"] = "passed"
        await run_script(
            "scripts.acceptance.verify_desktop_shutdown", "--sidecar", str(sidecar)
        )
        report["checks"]["abnormal_exit_cleanup"] = "passed"
        await run_script(
            "scripts.verify.verify_local_coding",
            "--sidecar",
            str(sidecar),
            "--bundled-host",
            str(host),
            "--output",
            str(args.output / "coding-fake.json"),
        )
        report["checks"]["packaged_fake_coding"] = "passed"
        if not args.fake_only:
            with tempfile.TemporaryDirectory(prefix="mlx-release-models-") as directory:
                process, client = await start_runtime(directory, str(sidecar))
                try:
                    async with client:
                        report["checks"]["real_chat"] = await verify_chat(
                            client, args.text_model
                        )
                        report["checks"]["real_image"] = await generate_and_check(
                            client, args.image_model, args.output / "image.png"
                        )
                finally:
                    await client.aclose()
                    await stop_runtime(process)
            await run_script(
                "scripts.verify.verify_local_speech",
                "--sidecar",
                str(sidecar),
                "--preset-model",
                args.preset_model,
                "--clone-model",
                args.clone_model,
                "--output",
                str(args.output / "speech"),
            )
            report["checks"]["real_speech"] = "passed"
            await run_script(
                "scripts.verify.verify_local_coding",
                "--sidecar",
                str(sidecar),
                "--bundled-host",
                str(host),
                "--model-path",
                args.text_model,
                "--output",
                str(args.output / "coding-real.json"),
            )
            report["checks"]["real_coding"] = "passed"
        else:
            report["unverified"].append("real text/image/speech/Coding inference")
        report["status"] = "passed_with_explicit_unverified_items"
    except BaseException:
        report["status"] = "failed"
        raise
    finally:
        (args.output / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--text-model")
    parser.add_argument("--image-model")
    parser.add_argument("--preset-model")
    parser.add_argument("--clone-model")
    parser.add_argument("--fake-only", action="store_true")
    parser.add_argument(
        "--output", type=Path, default=ROOT / ".build/release-acceptance"
    )
    asyncio.run(verify(parser.parse_args()))
