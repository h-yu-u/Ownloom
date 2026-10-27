#!/usr/bin/env python3
"""Collect a portable, read-only baseline for an Ownloom development Mac."""

from __future__ import annotations

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Optional, Sequence


CommandRunner = Callable[[Sequence[str]], Optional[str]]


@dataclass(frozen=True)
class SystemProbe:
    collected_at_utc: str
    host_architecture: str
    chip: str | None
    unified_memory_bytes: int | None
    macos_version: str | None
    python: dict[str, str]
    metal: dict[str, str | bool | None]
    disk: dict[str, int | str]


def run_command(arguments: Sequence[str]) -> str | None:
    try:
        result = subprocess.run(
            arguments,
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def parse_system_profiler(value: str | None) -> dict[str, str | bool | None]:
    if not value:
        return {"available": None, "description": None, "source": "system_profiler"}
    try:
        report = json.loads(value)
    except json.JSONDecodeError:
        return {"available": None, "description": None, "source": "system_profiler"}

    descriptions = _find_metal_descriptions(report)
    description = descriptions[0] if descriptions else None
    if description is None:
        available = None
    else:
        available = "unsupported" not in description.lower()
    return {
        "available": available,
        "description": description,
        "source": "system_profiler",
    }


def parse_hardware_overview(value: str | None) -> tuple[str | None, int | None]:
    if not value:
        return None, None
    try:
        report = json.loads(value)
    except json.JSONDecodeError:
        return None, None

    sections = report.get("SPHardwareDataType", [])
    if not isinstance(sections, list) or not sections or not isinstance(sections[0], dict):
        return None, None
    hardware = sections[0]
    chip = hardware.get("chip_type")
    memory_text = hardware.get("physical_memory")
    if not isinstance(memory_text, str):
        return chip if isinstance(chip, str) else None, None
    match = re.fullmatch(r"\s*([\d.]+)\s*(GB|MB)\s*", memory_text, re.IGNORECASE)
    if not match:
        return chip if isinstance(chip, str) else None, None
    units = {"GB": 1024**3, "MB": 1024**2}
    memory_bytes = int(float(match.group(1)) * units[match.group(2).upper()])
    return chip if isinstance(chip, str) else None, memory_bytes


def _find_metal_descriptions(value: object) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if "metal" in key.lower() and isinstance(item, (str, int, float)):
                found.append(str(item))
            found.extend(_find_metal_descriptions(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(_find_metal_descriptions(item))
    return found


def collect_probe(
    root: Path,
    runner: CommandRunner = run_command,
) -> SystemProbe:
    import datetime

    macos_version = runner(["sw_vers", "-productVersion"])
    hardware = runner(["system_profiler", "SPHardwareDataType", "-json"])
    profiler = runner(["system_profiler", "SPDisplaysDataType", "-json"])
    chip, memory_bytes = parse_hardware_overview(hardware)
    chip = chip or runner(["sysctl", "-n", "machdep.cpu.brand_string"])
    if memory_bytes is None:
        memory = runner(["sysctl", "-n", "hw.memsize"])
        try:
            memory_bytes = int(memory) if memory else None
        except ValueError:
            memory_bytes = None

    usage = shutil.disk_usage(root)
    python_path = shutil.which("python3")
    return SystemProbe(
        collected_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        host_architecture=platform.machine(),
        chip=chip,
        unified_memory_bytes=memory_bytes,
        macos_version=macos_version,
        python={
            "version": platform.python_version(),
            "executable": sys.executable,
            "python3_on_path": python_path or "not found",
        },
        metal=parse_system_profiler(profiler),
        disk={
            "path": str(root.resolve()),
            "total_bytes": usage.total,
            "free_bytes": usage.free,
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Directory whose filesystem capacity should be reported (default: cwd)",
    )
    parser.add_argument("--output", type=Path, help="Write JSON to this file instead of stdout")
    args = parser.parse_args()

    payload = json.dumps(asdict(collect_probe(args.root)), indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
