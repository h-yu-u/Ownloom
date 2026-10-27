"""Validated restores create a separate data profile; the previous profile stays intact."""

import hashlib
import json
import shutil
import sqlite3
import stat
import uuid
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import BadZipFile, ZipFile

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

MAX_ARCHIVE = 4 * 1024**3
MAX_EXPANDED = 20 * 1024**3


def _identifier(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise RuntimeFault(RuntimeErrorInfo("RESTORE_ID_INVALID", "恢复请求编号无效")) from error


def profile_base(database: Path) -> Path:
    if database.parent.name == "data" and database.parents[2].name == "profiles":
        return database.parents[3]
    return database.parent.parent if database.parent.name == "data" else database.parent


def resolve_profile(database: Path) -> Path:
    root = profile_base(database)
    pointer = root / "active-profile.json"
    if not pointer.is_file():
        return database
    value = json.loads(pointer.read_text())
    if value["id"] is None:
        return database
    identifier = str(uuid.UUID(value["id"]))
    target = root / "profiles" / identifier / "data" / "app.db"
    if not target.is_file():
        raise RuntimeFault(
            RuntimeErrorInfo("RESTORE_PROFILE_MISSING", "恢复资料库不存在，原资料库仍保留")
        )
    return target


class DataProfiles:
    def __init__(self, database: Path) -> None:
        self.root = profile_base(database)
        self.staging = self.root / ".restore"

    def upload_path(self) -> tuple[str, Path]:
        identifier = str(uuid.uuid4())
        directory = self.staging / identifier
        directory.mkdir(parents=True, mode=0o700)
        return identifier, directory / "backup.zip"

    def validate(self, identifier: str) -> dict[str, Any]:
        directory = self.staging / _identifier(identifier)
        source = directory / "backup.zip"
        try:
            with ZipFile(source) as archive:
                infos = archive.infolist()
                if (
                    source.stat().st_size > MAX_ARCHIVE
                    or len(infos) > 200000
                    or len({item.filename for item in infos}) != len(infos)
                ):
                    raise ValueError("BACKUP_MANIFEST_INVALID")
                if archive.getinfo("manifest.json").file_size > 4 * 1024**2:
                    raise ValueError("BACKUP_MANIFEST_INVALID")
                manifest = json.loads(archive.read("manifest.json"))
                if manifest.get("version") != 1:
                    raise ValueError("BACKUP_VERSION_UNSUPPORTED")
                expected = {item["path"]: item for item in manifest["files"]}
                if len(expected) != len(manifest["files"]) or set(expected) != {
                    item.filename for item in infos if item.filename != "manifest.json"
                }:
                    raise ValueError("BACKUP_MANIFEST_INVALID")
                if "runtime.db" not in expected or "node/manifest.json" not in expected:
                    raise ValueError("BACKUP_OWNER_MISSING")
                if sum(item.file_size for item in infos) > MAX_EXPANDED:
                    raise ValueError("BACKUP_TOO_LARGE")
                for item in infos:
                    path = PurePosixPath(item.filename)
                    if (
                        not path.parts
                        or item.filename != path.as_posix()
                        or path.is_absolute()
                        or ".." in path.parts
                        or "\\" in item.filename
                        or stat.S_ISLNK(item.external_attr >> 16)
                    ):
                        raise ValueError("BACKUP_PATH_INVALID")
                    if item.filename == "manifest.json":
                        continue
                    if path.parts[0] not in {"runtime.db", "media", "node"} or item.is_dir():
                        raise ValueError("BACKUP_PATH_INVALID")
                    definition = expected[item.filename]
                    if item.file_size != definition["bytes"]:
                        raise ValueError("BACKUP_HASH_MISMATCH")
                    target = directory / "verified" / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    digest = hashlib.sha256()
                    with archive.open(item) as incoming, target.open("wb") as outgoing:
                        while chunk := incoming.read(1024 * 1024):
                            digest.update(chunk)
                            outgoing.write(chunk)
                    if digest.hexdigest() != definition["sha256"]:
                        raise ValueError("BACKUP_HASH_MISMATCH")
            self._check_database(directory / "verified" / "runtime.db")
            result = {
                "id": identifier,
                "version": 1,
                "files": len(expected),
                "bytes": sum(item["bytes"] for item in expected.values()),
                "requiresRestart": True,
                "warnings": [
                    "恢复为独立资料库，保留原资料库，可撤销切换。",
                    "未完成任务标记中断，不自动重放工具。",
                    "模型路径及外部服务凭据可能需要重新配置。",
                ],
            }
            (directory / "preview.json").write_text(json.dumps(result))
            return result
        except (
            BadZipFile,
            KeyError,
            ValueError,
            TypeError,
            OSError,
            sqlite3.DatabaseError,
        ) as error:
            code = (
                str(error)
                if isinstance(error, ValueError) and str(error).startswith("BACKUP_")
                else "BACKUP_INVALID"
            )
            raise RuntimeFault(RuntimeErrorInfo(code, "备份校验失败，现有数据未修改")) from error

    @staticmethod
    def _check_database(path: Path) -> None:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("BACKUP_DATABASE_INVALID")

    def prepare(self, identifier: str) -> tuple[Path, Path]:
        identifier = _identifier(identifier)
        # Revalidate immediately before importing, including hashes of every media file.
        self.validate(identifier)
        source = self.staging / identifier / "verified"
        target = self.root / "profiles" / identifier
        data = target / "data"
        if (data / "coding" / "restore-complete").is_file():
            return source / "node", data / "coding"
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, mode=0o700)
        data.mkdir(mode=0o700)
        with sqlite3.connect(f"file:{source / 'runtime.db'}?mode=ro", uri=True) as incoming:
            with sqlite3.connect(data / "app.db") as outgoing:
                incoming.backup(outgoing)
        if (source / "media").is_dir():
            shutil.copytree(source / "media", target / "media")
        return source / "node", data / "coding"

    def discard(self, identifier: str) -> None:
        target = self.root / "profiles" / _identifier(identifier)
        if not (target / "data" / "coding" / "restore-complete").is_file():
            shutil.rmtree(target, ignore_errors=True)

    def activate(self, identifier: str) -> dict[str, Any]:
        identifier = _identifier(identifier)
        if not (
            self.root / "profiles" / identifier / "data" / "coding" / "restore-complete"
        ).is_file():
            raise RuntimeFault(
                RuntimeErrorInfo("RESTORE_INCOMPLETE", "所有数据所有者导入完成后才能切换")
            )
        pointer = self.root / "active-profile.json"
        previous = json.loads(pointer.read_text()).get("id") if pointer.is_file() else None
        if previous == identifier:
            return {"requiresRestart": True, "profileId": identifier}
        temporary = pointer.with_suffix(".pending")
        temporary.write_text(json.dumps({"id": identifier, "previous": previous}))
        temporary.replace(pointer)
        return {"requiresRestart": True, "profileId": identifier}

    def rollback(self) -> dict[str, bool]:
        pointer = self.root / "active-profile.json"
        if not pointer.is_file():
            raise RuntimeFault(RuntimeErrorInfo("RESTORE_NOT_FOUND", "没有可回滚的资料库切换"))
        current = json.loads(pointer.read_text())
        previous = current.get("previous")
        if previous is not None:
            uuid.UUID(previous)
        temporary = pointer.with_suffix(".pending")
        temporary.write_text(json.dumps({"id": previous, "previous": current.get("id")}))
        temporary.replace(pointer)
        return {"requiresRestart": True}
