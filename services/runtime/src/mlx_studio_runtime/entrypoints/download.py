"""Managed transfer child: fixed revision, resumable HF files, verified completion."""

import errno
import hashlib
import json
import os
import sys
import threading
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

PROTOCOL_OUTPUT = sys.stdout
OUTPUT_LOCK = threading.Lock()


def emit(value: dict[str, Any]) -> None:
    with OUTPUT_LOCK:
        print(json.dumps(value), flush=True, file=PROTOCOL_OUTPUT)


def observe_progress(target: Path, files: list[dict[str, Any]], stopped: threading.Event) -> None:
    while not stopped.wait(1):
        try:
            completed = sum(
                (target / item["path"]).stat().st_size
                for item in files
                if (target / item["path"]).is_file()
            )
            partial = sum(
                path.stat().st_size
                for path in (target / ".cache" / "huggingface" / "download").rglob("*.incomplete")
            )
            emit(
                {
                    "type": "progress",
                    "transferredBytes": completed + partial,
                    "progressOrigin": "local_cache",
                }
            )
        except OSError:
            continue  # A concurrent atomic cache rename is retried at the next observation.


def main() -> int:
    try:
        from huggingface_hub import HfApi, snapshot_download

        request = json.loads(sys.stdin.readline())
        threading.Thread(target=lambda: (sys.stdin.read(), os._exit(1)), daemon=True).start()
        repo, revision = request["repo"], request.get("revision")
        metadata = HfApi().model_info(repo, revision=revision, files_metadata=True)
        if not metadata.sha:
            raise ValueError("MODEL_REVISION_UNRESOLVED")
        root = Path(os.getenv("MLX_STUDIO_MODELS_DIR", Path.home() / "MLXModels")).expanduser()
        target = (
            root / repo.replace("/", "--") / hashlib.sha256(metadata.sha.encode()).hexdigest()[:16]
        )
        files = [
            {"path": item.rfilename, "size": item.size, "sha256": getattr(item.lfs, "sha256", None)}
            for item in metadata.siblings or []
        ]
        emit({"type": "plan", "revision": metadata.sha, "files": files, "path": str(target)})
        stopped = threading.Event()
        observer = threading.Thread(
            target=observe_progress, args=(target, files, stopped), daemon=True
        )
        observer.start()
        try:
            with redirect_stdout(sys.stderr):
                snapshot_download(repo_id=repo, revision=metadata.sha, local_dir=str(target))
        finally:
            stopped.set()
            observer.join(timeout=2)
        emit({"type": "verifying"})
        for item in files:
            path = (target / item["path"]).resolve()
            if not path.is_relative_to(target.resolve()) or not path.is_file():
                raise ValueError("DOWNLOAD_FILE_MISSING")
            if item["size"] is not None and path.stat().st_size != item["size"]:
                raise ValueError("DOWNLOAD_SIZE_MISMATCH")
            if item["sha256"]:
                with path.open("rb") as source:
                    if hashlib.file_digest(source, "sha256").hexdigest() != item["sha256"]:
                        raise ValueError("DOWNLOAD_HASH_MISMATCH")
        emit({"type": "complete", "path": str(target), "revision": metadata.sha})
        return 0
    except Exception as error:  # Child boundary: never return credentials/upstream response text.
        status = getattr(getattr(error, "response", None), "status_code", None)
        code = (
            "DOWNLOAD_AUTH_REQUIRED"
            if status == 401
            else "DOWNLOAD_PERMISSION_DENIED"
            if status == 403
            else "DOWNLOAD_DISK_FULL"
            if isinstance(error, OSError) and error.errno == errno.ENOSPC
            else "DOWNLOAD_NETWORK_FAILED"
            if "timeout" in type(error).__name__.lower()
            or "connect" in type(error).__name__.lower()
            else "MODEL_DOWNLOAD_FAILED"
        )
        emit({"type": "error", "code": code})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
