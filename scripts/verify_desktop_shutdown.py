"""Simulate Tauri killing the onefile bootloader and closing its owned stdin pipe."""

import argparse
import asyncio
import json
import os
import secrets
import signal
import tempfile
from pathlib import Path

import httpx
from verification_models import seed_fake_text
from verify_local_chat import turn


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


async def descendants(root: int) -> set[int]:
    probe = await asyncio.create_subprocess_exec(
        "ps", "-axo", "pid=,ppid=", stdout=asyncio.subprocess.PIPE
    )
    output, _ = await probe.communicate()
    parents = [tuple(map(int, line.split())) for line in output.splitlines()]
    found = {root}
    while True:
        expanded = found | {pid for pid, parent in parents if parent in found}
        if expanded == found:
            return found
        found = expanded


async def verify(sidecar: str) -> None:
    with tempfile.TemporaryDirectory(prefix="mlx-desktop-exit-") as directory:
        seed_fake_text(Path(directory) / "app.db")
        token = secrets.token_urlsafe(32)
        process = await asyncio.create_subprocess_exec(
            str(Path(sidecar).resolve()),
            env={
                **os.environ,
                "MLX_STUDIO_DATA_DIR": directory,
                "MLX_STUDIO_SESSION_TOKEN": token,
                "MLX_STUDIO_PARENT_PIPE": "1",
                "PYTHONPATH": "",
            },
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
        )
        runtime_pid = None
        owned: set[int] = set()
        try:
            assert process.stdout is not None and process.stdin is not None
            frame = json.loads(await asyncio.wait_for(process.stdout.readline(), 30))
            runtime_pid = frame["pid"]
            async with httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{frame['port']}",
                headers={"Authorization": f"Bearer {token}"},
                trust_env=False,
                timeout=30,
            ) as client:
                created = await client.post(
                    "/internal/v1/conversations",
                    json={"title": "Exit QA", "model_id": "builtin-fake-text"},
                )
                created.raise_for_status()
                await turn(
                    client,
                    created.json()["id"],
                    "builtin-fake-text",
                    "exit verification",
                )
            owned = await descendants(runtime_pid)
            assert len(owned) >= 2, "Expected a live Worker before shell termination"
            process.kill()
            process.stdin.close()
            await process.wait()
            async with asyncio.timeout(15):
                while any(alive(pid) for pid in owned):
                    await asyncio.sleep(0.1)
        finally:
            if process.stdin:
                process.stdin.close()
            if runtime_pid and alive(runtime_pid):
                os.kill(runtime_pid, signal.SIGINT)
            if process.returncode is None:
                process.kill()
                await process.wait()
    print(json.dumps({"desktop_kill_runtime_and_worker_cleanup": "passed"}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar", required=True)
    asyncio.run(verify(parser.parse_args().sidecar))
