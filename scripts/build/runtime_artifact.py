"""Create and validate a flat, source-bound Runtime artifact without executing it."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path

from scripts.build.runtime_artifact_policy import (
    MAX_BINARY,
    MAX_MANIFEST,
    SIDECAR,
    TARGET,
    ArtifactError,
    Provenance,
    expected_manifest,
    file_digest,
    read_manifest,
    verify_binary,
)


def verify_directory(directory: Path, expected: dict[str, object]) -> None:
    if directory.is_symlink() or {item.name for item in directory.iterdir()} != {
        "manifest.json",
        SIDECAR,
    }:
        raise ArtifactError("artifact must contain exactly two regular files")
    manifest = directory / "manifest.json"
    file_digest(manifest, MAX_MANIFEST)
    binary = read_manifest(manifest.read_bytes(), expected)
    verify_binary(directory / SIDECAR, binary)


def verify_build_report(root: Path, binary: dict[str, object]) -> None:
    report_path = root / ".build/runtime/archive-size.json"
    file_digest(report_path, MAX_MANIFEST)
    report = json.loads(report_path.read_bytes())
    if (
        report.get("profile") != "release"
        or report.get("boundary_status") != "passed"
        or report.get("sidecar") != binary
    ):
        raise ArtifactError("release build report does not identify this binary")


def create_artifact(root: Path, output: Path, source: Provenance) -> None:
    expected = expected_manifest(root, source, installed=True)
    size, digest = file_digest(root / TARGET)
    binary = {"name": SIDECAR, "bytes": size, "sha256": digest}
    verify_build_report(root, binary)
    verify_binary(root / TARGET, binary)
    if output.exists() or output.is_symlink():
        raise ArtifactError("artifact output already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".runtime-create-", dir=output.parent
    ) as temp:
        staging = Path(temp) / "artifact"
        staging.mkdir()
        shutil.copyfile(root / TARGET, staging / SIDECAR)
        (staging / SIDECAR).chmod(0o644)
        (staging / "manifest.json").write_text(
            json.dumps({**expected, "binary": binary}, indent=2) + "\n"
        )
        verify_directory(staging, expected_manifest(root, source, installed=True))
        staging.rename(output)


def archive_entries(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    entries = archive.infolist()
    if len(entries) != 2 or {item.filename for item in entries} != {
        "manifest.json",
        SIDECAR,
    }:
        raise ArtifactError("archive must contain exactly two flat files")
    for item in entries:
        mode = stat.S_IFMT(item.external_attr >> 16)
        maximum = MAX_MANIFEST if item.filename == "manifest.json" else MAX_BINARY
        if (
            mode not in {0, stat.S_IFREG}
            or item.orig_filename != item.filename
            or item.is_dir()
            or item.external_attr & 0x10
            or item.flag_bits & 1
            or item.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
            or not 0 < item.file_size <= maximum
        ):
            raise ArtifactError("unsafe archive entry")
    return {item.filename: item for item in entries}


def extract_archive(path: Path, directory: Path, expected: dict[str, object]) -> None:
    with zipfile.ZipFile(path) as archive:
        entries = archive_entries(archive)
        manifest = archive.read(entries["manifest.json"])
        binary = read_manifest(manifest, expected)
        if entries[SIDECAR].file_size != binary["bytes"]:
            raise ArtifactError("archive binary size differs")
        (directory / "manifest.json").write_bytes(manifest)
        written = 0
        with (
            archive.open(entries[SIDECAR]) as source,
            (directory / SIDECAR).open("xb") as target,
        ):
            while chunk := source.read(1024 * 1024):
                written += len(chunk)
                if written > binary["bytes"]:
                    raise ArtifactError("expanded binary exceeds declared size")
                target.write(chunk)
        (directory / SIDECAR).chmod(0o600)
    verify_directory(directory, expected)


def provenance(commit: str) -> Provenance:
    return Provenance(
        os.environ.get("GITHUB_REPOSITORY", ""),
        commit,
        int(os.environ.get("GITHUB_RUN_ID", "0")),
        int(os.environ.get("GITHUB_RUN_ATTEMPT", "0")),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    create = subcommands.add_parser("create")
    create.add_argument("--output", type=Path, required=True)
    verify = subcommands.add_parser("verify")
    verify.add_argument("--directory", type=Path, required=True)
    for command in (create, verify):
        command.add_argument("--commit", required=True)
    args = parser.parse_args()
    root, source = Path.cwd(), provenance(args.commit)
    if args.command == "create":
        create_artifact(root, args.output, source)
    else:
        verify_directory(
            args.directory, expected_manifest(root, source, installed=True)
        )
    print(f"Runtime artifact {args.command}: verified release arm64 payload")


if __name__ == "__main__":
    main()
