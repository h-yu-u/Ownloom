"""Bind an ephemeral loopback port and emit a single non-secret handshake frame."""

import asyncio
import json
import multiprocessing
import os
import secrets
import socket
import sys

import uvicorn

from mlx_studio_runtime import PROTOCOL_VERSION
from mlx_studio_runtime.adapters.parent_lifetime import watch_parent_pipe


async def serve() -> None:
    token = os.getenv("MLX_STUDIO_SESSION_TOKEN")
    if not token:
        token = secrets.token_urlsafe(32)
        os.environ["MLX_STUDIO_SESSION_TOKEN"] = token
    from mlx_studio_runtime.entrypoints.http.app import create_app

    runtime_app = create_app()

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    sock.setblocking(False)
    port = int(sock.getsockname()[1])
    config = uvicorn.Config(
        runtime_app,
        host="127.0.0.1",
        port=port,
        log_config=None,
        access_log=False,
        server_header=False,
    )
    server = uvicorn.Server(config)

    def parent_exited() -> None:
        server.should_exit = True

    release_parent_watch = watch_parent_pipe(parent_exited)
    server_task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started and not server_task.done():
        await asyncio.sleep(0.02)
    if server_task.done():
        await server_task
        raise RuntimeError("Runtime failed before startup")
    handshake = {
        "type": "runtime.ready",
        "port": port,
        "pid": os.getpid(),
        "protocol_version": PROTOCOL_VERSION,
    }
    sys.stdout.write(json.dumps(handshake, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    try:
        await server_task
    finally:
        release_parent_watch()


def main() -> int:
    if sys.argv[1:] == ["--check-bundle"]:
        from mlx_studio_runtime.adapters.worker_runtime.bundle_check import main as check_bundle

        return check_bundle()
    if sys.argv[1:] == ["--download"]:
        from mlx_studio_runtime.entrypoints.download import main as download_main

        return download_main()
    if sys.argv[1:] == ["--prepare"]:
        from mlx_studio_runtime.entrypoints.prepare import main as prepare_main

        return prepare_main()
    if sys.argv[1:] == ["--worker"]:
        from mlx_studio_runtime.entrypoints.worker.main import main as worker_main

        return worker_main()
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        print(f"Runtime startup failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
