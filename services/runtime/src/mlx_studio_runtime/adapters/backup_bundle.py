"""Immutable manifest plus owner-generated database snapshots and transcript prefixes."""

import hashlib
import json
import time
import uuid
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from mlx_studio_runtime.adapters.data_profiles import MAX_ARCHIVE, MAX_EXPANDED
from mlx_studio_runtime.adapters.storage_management import StorageManagement
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


def create_backup(storage: StorageManagement, node: Path, allowed_node: Path) -> Path:
    if not node.resolve().is_relative_to((allowed_node / "exports").resolve()):
        raise ValueError("BACKUP_PATH_INVALID")
    directory = storage.database.path.parent / "exports" / str(uuid.uuid4())
    directory.mkdir(parents=True, mode=0o700)
    database = directory / "runtime.db"
    storage.backup(database)
    target = directory / "ownloom-backup.zip"
    manifest: dict[str, object] = {"version": 1, "cutoff": int(time.time()), "files": []}
    files: list[dict[str, object]] = []
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        sources = [(database, "runtime.db")]
        for root, prefix in [(node, "node"), (storage.database.media_path, "media")]:
            if root.is_dir():
                sources.extend(
                    (path, f"{prefix}/{path.relative_to(root).as_posix()}")
                    for path in root.rglob("*")
                    if path.is_file()
                    and not path.is_symlink()
                    and ".pending" not in path.parts
                    and ".staging" not in path.parts
                    and ".thumbnails" not in path.parts
                )
        if sum(source.stat().st_size for source, _ in sources) > MAX_EXPANDED:
            raise RuntimeFault(RuntimeErrorInfo("BACKUP_TOO_LARGE", "备份超过当前恢复上限 20 GiB"))
        for source, name in sources:
            with source.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            archive.write(source, name)
            files.append({"path": name, "sha256": digest, "bytes": source.stat().st_size})
        manifest.update(
            files=files,
            recovery="恢复时必须核对全部 hash、重映射 Pi 路径并中断未完成任务；不得自动重放工具。",
        )
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    target.chmod(0o600)
    if target.stat().st_size > MAX_ARCHIVE:
        target.unlink()
        raise RuntimeFault(RuntimeErrorInfo("BACKUP_TOO_LARGE", "压缩备份超过当前恢复上限 4 GiB"))
    return target


async def create_backup_async(storage: StorageManagement, node: Path, allowed_node: Path) -> Path:
    import asyncio

    return await asyncio.to_thread(create_backup, storage, node, allowed_node)
