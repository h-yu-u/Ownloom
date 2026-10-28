"""Account for a frozen Runtime's contents without executing its code or models."""

import argparse
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from scripts.build.runtime_bundle import is_numerical_test


@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    stored_bytes: int
    kind: str


def read_entries(sidecar: Path) -> list[ArchiveEntry]:
    # The build environment pins this reader to the PyInstaller used to freeze it.
    from PyInstaller.archive.readers import CArchiveReader

    archive = CArchiveReader(str(sidecar))
    entries: list[ArchiveEntry] = []
    for name, (_, stored, _, _, kind) in archive.toc.items():
        if kind != "z":
            entries.append(ArchiveEntry(name, stored, "file"))
            continue
        modules = archive.open_embedded_archive(name).toc
        module_bytes = 0
        for module, (_, _, length) in modules.items():
            entries.append(ArchiveEntry(module, length, "module"))
            module_bytes += length
        if module_bytes > stored:
            raise ValueError(f"Embedded archive exceeds its container: {name}")
        entries.append(ArchiveEntry(name, stored - module_bytes, "pyz-overhead"))
    return entries


def package_name(entry: ArchiveEntry) -> str:
    if entry.kind == "pyz-overhead":
        return "<PYZ headers and index>"
    if entry.kind == "module":
        return entry.name.partition(".")[0]
    root = entry.name.replace("\\", "/").partition("/")[0]
    return "<distribution metadata>" if root.endswith(".dist-info") else root


def summarize(entries: list[ArchiveEntry], sidecar_bytes: int) -> dict[str, object]:
    groups: dict[str, int] = defaultdict(int)
    rejected: list[str] = []
    for entry in entries:
        if entry.stored_bytes < 0:
            raise ValueError(f"Negative archive size: {entry.name}")
        groups[package_name(entry)] += entry.stored_bytes
        if entry.kind != "pyz-overhead" and is_numerical_test(entry.name):
            rejected.append(entry.name)
    payload_bytes = sum(groups.values())
    if payload_bytes > sidecar_bytes:
        raise ValueError("Archive payload exceeds the executable size")
    groups["<executable, archive index and signature>"] = sidecar_bytes - payload_bytes
    return {
        "stored_bytes_by_package": dict(
            sorted(groups.items(), key=lambda item: (-item[1], item[0]))
        ),
        "entry_count": len(entries),
        "forbidden_test_entries": sorted(rejected),
        "boundary_status": "failed" if rejected else "passed",
    }


def create_report(sidecar: Path, profile: str) -> dict[str, object]:
    sidecar_bytes = sidecar.stat().st_size
    with sidecar.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {
        "schema_version": 1,
        "profile": profile,
        "sidecar": {
            "name": sidecar.name,
            "bytes": sidecar_bytes,
            "sha256": digest,
        },
        "measurement": "bytes stored inside the sidecar; not DMG contribution",
        **summarize(read_entries(sidecar), sidecar_bytes),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile", choices=("release", "fake"), required=True)
    args = parser.parse_args()
    report = create_report(args.sidecar, args.profile)
    rendered = json.dumps(report, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(rendered, encoding="utf-8")
    temporary.replace(args.output)
    print(rendered, end="")
    return int(report["boundary_status"] != "passed")


if __name__ == "__main__":
    raise SystemExit(main())
