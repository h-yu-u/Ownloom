"""Identity and compatibility rules for reusing a checked Runtime Sidecar."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import re
import stat
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path

SIDECAR = "mlx-studio-runtime-aarch64-apple-darwin"
TARGET = Path("apps/desktop/src-tauri/binaries") / SIDECAR
WORKFLOW = ".github/workflows/ci.yml"
MAX_BINARY = 2 * 1024**3
MAX_ARCHIVE = MAX_BINARY + 64 * 1024**2
MAX_MANIFEST = 64 * 1024
INPUTS = (
    "services/runtime/src",
    "services/runtime/pyproject.toml",
    "services/runtime/uv.lock",
    "scripts/build",
    "scripts/acceptance/verify_packaged_runtime.py",
    "scripts/acceptance/verify_desktop_shutdown.py",
    WORKFLOW,
)
REQUIRED = (
    "services/runtime/pyproject.toml",
    "services/runtime/uv.lock",
    "scripts/build/runtime.spec",
    "scripts/build/runtime_bundle.py",
    "scripts/build/build-runtime.sh",
    WORKFLOW,
)


class ArtifactError(ValueError):
    """A static validation reason that never embeds external payloads."""


@dataclass(frozen=True)
class Provenance:
    repository: str
    commit: str
    run_id: int
    attempt: int

    def __post_init__(self) -> None:
        validate_identity(self.repository, self.commit)
        if any(
            type(value) is not int or value < 1 for value in (self.run_id, self.attempt)
        ):
            raise ArtifactError("invalid run identity")


def validate_identity(repository: str, commit: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) or any(
        part in {".", ".."} for part in repository.split("/")
    ):
        raise ArtifactError("invalid repository identity")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ArtifactError("invalid commit identity")


def file_digest(
    path: Path, maximum: int = MAX_BINARY, *, allow_empty: bool = False
) -> tuple[int, str]:
    info = path.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or not int(not allow_empty) <= info.st_size <= maximum
    ):
        raise ArtifactError("invalid artifact file")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return info.st_size, digest


def input_digest(root: Path, commit: str) -> str:
    def git(*args: str) -> bytes:
        return subprocess.check_output(
            ["git", "-C", str(root), *args], stderr=subprocess.DEVNULL
        )

    if git("rev-parse", "HEAD").decode().strip() != commit:
        raise ArtifactError("checkout commit differs")
    if git("status", "--porcelain", "--untracked-files=no"):
        raise ArtifactError("checkout has tracked changes")
    if git("status", "--porcelain", "--untracked-files=all", "--", *INPUTS):
        raise ArtifactError("build inputs are not clean")
    names = sorted(git("ls-files", "-z", "--", *INPUTS).decode().split("\0")[:-1])
    if not set(REQUIRED).issubset(names) or not any(
        name.startswith("services/runtime/src/") for name in names
    ):
        raise ArtifactError("build inputs are incomplete")
    digest = hashlib.sha256()
    for name in names:
        size, content = file_digest(root / name, allow_empty=True)
        digest.update(json.dumps([name, size, content], ensure_ascii=True).encode())
        digest.update(b"\n")
    return digest.hexdigest()


def build_versions(root: Path, installed: bool) -> dict[str, str]:
    lock = tomllib.loads((root / "services/runtime/uv.lock").read_text())
    versions = {}
    for name in ("pyinstaller", "pyinstaller-hooks-contrib"):
        matches = {item["version"] for item in lock["package"] if item["name"] == name}
        if len(matches) != 1:
            raise ArtifactError("ambiguous locked build tool")
        version = matches.pop()
        if installed and importlib.metadata.version(name) != version:
            raise ArtifactError("installed build tool differs from lock")
        versions[name] = version
    return versions


def environment(root: Path, installed: bool = False) -> dict[str, object]:
    if (
        platform.system() != "Darwin"
        or platform.machine() != "arm64"
        or platform.python_implementation() != "CPython"
        or not platform.python_version().startswith("3.12.")
    ):
        raise ArtifactError("incompatible build platform")
    image = {"os": os.environ.get("ImageOS"), "version": os.environ.get("ImageVersion")}
    if any(not isinstance(value, str) or not value.strip() for value in image.values()):
        raise ArtifactError("runner image identity is unavailable")
    return {
        "platform": {"system": "Darwin", "architecture": "arm64"},
        "toolchain": {
            "python": platform.python_version(),
            "implementation": "CPython",
            **build_versions(root, installed),
        },
        "runnerImage": image,
    }


def expected_manifest(
    root: Path, source: Provenance, installed: bool = False
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "repository": source.repository,
        "commit": source.commit,
        "runId": source.run_id,
        "runAttempt": source.attempt,
        "profile": "release",
        "inputsSha256": input_digest(root, source.commit),
        **environment(root, installed),
    }


def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for name, value in pairs:
        if name in result:
            raise ArtifactError("duplicate manifest field")
        result[name] = value
    return result


def read_manifest(data: bytes, expected: dict[str, object]) -> dict[str, object]:
    if len(data) > MAX_MANIFEST:
        raise ArtifactError("manifest exceeds limit")
    manifest = json.loads(data, object_pairs_hook=unique_object)
    if not isinstance(manifest, dict) or set(manifest) != {*expected, "binary"}:
        raise ArtifactError("invalid manifest fields")
    # JSON comparison also distinguishes booleans from integers.
    identity = {key: manifest[key] for key in expected}
    if json.dumps(identity, sort_keys=True) != json.dumps(expected, sort_keys=True):
        raise ArtifactError("artifact provenance or compatibility differs")
    binary = manifest["binary"]
    if (
        not isinstance(binary, dict)
        or set(binary) != {"name", "bytes", "sha256"}
        or binary["name"] != SIDECAR
        or type(binary["bytes"]) is not int
        or not 0 < binary["bytes"] <= MAX_BINARY
        or not isinstance(binary["sha256"], str)
        or not re.fullmatch(r"[0-9a-f]{64}", binary["sha256"])
    ):
        raise ArtifactError("invalid binary manifest")
    return binary


def verify_binary(path: Path, binary: dict[str, object]) -> None:
    if file_digest(path) != (binary["bytes"], binary["sha256"]):
        raise ArtifactError("binary digest or size differs")
    with path.open("rb") as stream:
        header = stream.read(8)
    if header != b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01":
        raise ArtifactError("binary is not a thin arm64 Mach-O")
