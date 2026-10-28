"""Remove only UUID directories allocated by the backup/restore adapters."""

import shutil
import time
import uuid
from collections.abc import Collection
from pathlib import Path

TEMPORARY_TTL = 24 * 60 * 60


def owned_directory(root: Path, directory: Path) -> Path:
    if (
        str(uuid.UUID(directory.name)) != directory.name
        or directory.is_symlink()
        or directory.resolve().parent != root.resolve()
    ):
        raise ValueError("TEMPORARY_PATH_INVALID")
    return directory


def discard_temporary(root: Path, directory: Path) -> None:
    shutil.rmtree(owned_directory(root, directory), ignore_errors=True)


def prune_temporaries(root: Path, protected: Collection[str] = ()) -> None:
    if not root.is_dir():
        return
    cutoff = time.time() - TEMPORARY_TTL
    for directory in root.iterdir():
        try:
            owned_directory(root, directory)
            if (
                directory.name not in protected
                and directory.is_dir()
                and directory.stat().st_mtime < cutoff
            ):
                discard_temporary(root, directory)
        except (ValueError, FileNotFoundError):
            continue
