"""Reproduce a Pi → local Worker → managed edit → verified command acceptance probe."""

import argparse
import asyncio
import json
import os
import signal
import socket
import sys
import tempfile
from pathlib import Path

import httpx

from scripts.verify.verification_models import seed_fake_text

ROOT = Path(__file__).parents[2]


async def verify(
    model_path: str | None,
    output: Path,
    bundled_host: str | None,
    sidecar: str | None,
    task: str | None = None,
) -> None:
    with tempfile.TemporaryDirectory(prefix="mlx-coding-acceptance-") as directory:
        if not model_path:
            seed_fake_text(Path(directory) / "app.db")
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.close()
        env = {
            **os.environ,
            "PYTHONPATH": "" if sidecar else str(ROOT / "services/runtime/src"),
            "MLX_STUDIO_SESSION_TOKEN": "isolated-coding-acceptance",
            "MLX_STUDIO_DATA_DIR": directory,
        }
        if bundled_host:
            env["MLX_STUDIO_CODING_RESOURCES"] = str(Path(bundled_host).resolve())
        command = (
            [str(Path(sidecar).resolve())]
            if sidecar
            else [
                sys.executable,
                "-m",
                "uvicorn",
                "mlx_studio_runtime.entrypoints.http.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ]
        )
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=ROOT,
            env=env,
            stdout=asyncio.subprocess.PIPE if sidecar else asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            if sidecar:
                assert process.stdout is not None
                frame = json.loads(
                    await asyncio.wait_for(process.stdout.readline(), timeout=60)
                )
                if (
                    frame.get("protocol_version") != 1
                    or frame.get("type") != "runtime.ready"
                ):
                    raise RuntimeError("Packaged Runtime handshake invalid")
                port = frame["port"]
            async with httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{port}",
                headers={"Authorization": "Bearer isolated-coding-acceptance"},
                timeout=1250,
            ) as client:
                await ready(client)
                model_id = "builtin-fake-text"
                if model_path:
                    imported = await client.post(
                        "/internal/v1/models/import",
                        json={"path": str(Path(model_path).resolve())},
                    )
                    imported.raise_for_status()
                    model_id = imported.json()["id"]
                response = await client.post(
                    f"/internal/v1/coding/capabilities/{model_id}/verify"
                )
                response.raise_for_status()
                reports = list((Path(directory) / "coding").glob("probe-report-*.json"))
                if len(reports) != 1:
                    raise RuntimeError("Acceptance evidence missing")
                report = json.loads(reports[0].read_text())
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
                output.chmod(0o600)
                if response.json()["status"] != "verified":
                    raise RuntimeError(response.json()["detail"])
                checks = report["verifications"]
                print(
                    json.dumps(
                        {
                            "status": "verified",
                            "modelId": model_id,
                            "provider": "real-mlx" if model_path else "scripted-fake",
                            "toolCalls": sum(
                                event["type"] == "tool.started"
                                for event in report["events"]
                            ),
                            "verificationExitCodes": [
                                check["exitCode"] for check in checks
                            ],
                            "report": str(output.resolve()),
                        },
                        ensure_ascii=False,
                    )
                )
                if task:
                    from scripts.verify.verify_coding_task import verify_task

                    await verify_task(
                        client,
                        model_id,
                        Path(directory),
                        output.with_name(output.stem + "-task.json"),
                        task,
                    )
        finally:
            if process.returncode is None:
                process.send_signal(signal.SIGINT)
            await asyncio.wait_for(process.wait(), timeout=20)
            if process.returncode != 0:
                raise RuntimeError(f"Runtime shutdown failed: {process.returncode}")


async def ready(client: httpx.AsyncClient) -> None:
    for _ in range(150):
        try:
            response = await client.get("/internal/v1/runtime/info")
            if response.status_code == 200:
                return
        except httpx.ConnectError:
            pass
        await asyncio.sleep(0.1)
    raise RuntimeError("Runtime failed to start")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", help="Omit to run the scripted Fake provider")
    parser.add_argument("--sidecar", help="Use the packaged Runtime executable")
    parser.add_argument("--bundled-host", help="Path to the packaged Coding resources")
    parser.add_argument(
        "--output", type=Path, default=ROOT / ".build/coding-acceptance.json"
    )
    parser.add_argument(
        "--task",
        help="Also run an open-ended task; approvals require interactive review",
    )
    args = parser.parse_args()
    asyncio.run(
        verify(args.model_path, args.output, args.bundled_host, args.sidecar, args.task)
    )


if __name__ == "__main__":
    main()
