"""Cancellation returns only after the transfer child and its pipes have stopped."""

import asyncio
import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


async def transfer(
    repo: str,
    revision: str | None,
    update: Callable[[dict[str, Any]], None],
) -> tuple[Path, str]:
    command = (
        [sys.executable, "--download"]
        if getattr(sys, "frozen", False)
        else [sys.executable, "-m", "mlx_studio_runtime.entrypoints.download"]
    )
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"MLX_STUDIO_SESSION_TOKEN", "MLX_STUDIO_EXTERNAL_API_TOKEN"}
    }
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=env,
        limit=2 * 1024 * 1024,
    )
    assert process.stdin and process.stdout
    result: tuple[Path, str] | None = None
    try:
        process.stdin.write((json.dumps({"repo": repo, "revision": revision}) + "\n").encode())
        await process.stdin.drain()
        while line := await process.stdout.readline():
            event = json.loads(line)
            if event["type"] == "error":
                raise RuntimeFault(
                    RuntimeErrorInfo(event["code"], "模型下载失败，请检查网络、权限或磁盘", True)
                )
            update(event)
            if event["type"] == "complete":
                result = Path(event["path"]), event["revision"]
        if await process.wait() != 0 or result is None:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_DOWNLOAD_FAILED", "下载进程未完成", True))
        return result
    finally:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 3)
            except TimeoutError:
                process.kill()
                await asyncio.wait_for(process.wait(), 3)
        process.stdin.close()
