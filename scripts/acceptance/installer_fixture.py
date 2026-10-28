"""Local release transport for installer acceptance; no external requests are made."""

from __future__ import annotations

import json
import os
import plistlib
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

BASE = "https://github.com/h-yu-u/Ownloom/releases/"


class InstallerFixture:
    def __init__(self, root: Path, assets: Path, app: Path | None = None) -> None:
        self.root = root
        self.config: dict[str, object] = {"root": str(root), "assets": str(assets)}
        if app is not None:
            self.config["app"] = str(app)
        for name in ("bin", "home", "temporary"):
            (root / name).mkdir(parents=True, exist_ok=True)
        commands = ["curl"]
        if app is not None:
            commands += [
                "uname",
                "sysctl",
                "plutil",
                "hdiutil",
                "ditto",
                "file",
                "codesign",
                "pgrep",
                "mv",
            ]
        for name in commands:
            path = root / "bin" / name
            path.write_text(
                "#!/bin/sh\nexec "
                + " ".join(
                    shlex.quote(value) for value in (sys.executable, __file__, name)
                )
                + ' "$@"\n'
            )
            path.chmod(0o755)
        self.update()

    def update(self, **options: object) -> None:
        self.config.update(options)
        (self.root / "fixture.json").write_text(json.dumps(self.config))

    @property
    def environment(self) -> dict[str, str]:
        return {
            "PATH": f"{self.root / 'bin'}:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(self.root / "home"),
            "TMPDIR": str(self.root / "temporary"),
            "LC_ALL": "C",
            "OWNLOOM_INSTALLER_FIXTURE": str(self.root / "fixture.json"),
        }

    def calls(self) -> list[list[str]]:
        path = self.root / "calls.jsonl"
        return (
            [json.loads(line) for line in path.read_text().splitlines()]
            if path.exists()
            else []
        )


def download(arguments: list[str], config: dict[str, object]) -> int:
    url = arguments[-1]
    if not url.startswith(BASE):
        raise ValueError(f"Unexpected installer network destination: {url}")
    relative = url.removeprefix(BASE)
    parts = relative.split("/")
    if len(parts) != 3 or parts[:2] == ["download", "latest"]:
        raise ValueError(f"Unexpected release asset URL: {url}")
    if parts[:2] != ["latest", "download"] and parts[0] != "download":
        raise ValueError(f"Unexpected release asset URL: {url}")
    name = parts[-1]
    if name not in {
        "release-metadata.json",
        "SHA256SUMS",
        "ownloom-darwin-arm64.dmg",
        "install.sh",
    }:
        raise ValueError(f"Unexpected release asset: {name}")
    if config.get("download_failure") in {name, "all"}:
        return 22
    source = Path(str(config["assets"])) / name
    latest = config.get("latest_metadata")
    if parts[:2] == ["latest", "download"] and latest:
        source = Path(str(latest))
    flag = "--output" if "--output" in arguments else "-o"
    destination = Path(arguments[arguments.index(flag) + 1])
    shutil.copyfile(source, destination)
    if config.get("corrupt_download") == name:
        with destination.open("ab") as stream:
            stream.write(b"corrupted fixture download")
    return 0


def extract(arguments: list[str]) -> int:
    data = Path(arguments[-1]).read_bytes()
    value = json.loads(data) if data.lstrip().startswith(b"{") else plistlib.loads(data)
    key = arguments[arguments.index("-extract") + 1]
    if key not in value:
        return 1
    result = value[key]
    print(str(result).lower() if isinstance(result, bool) else result)
    return 0


def mount(arguments: list[str], config: dict[str, object]) -> int:
    marker = Path(str(config["root"])) / "mounted"
    if arguments[0] == "attach":
        if config.get("attach_failure"):
            return 1
        destination = Path(arguments[arguments.index("-mountpoint") + 1])
        shutil.copytree(
            Path(str(config["app"])), destination / "Ownloom.app", symlinks=True
        )
        marker.write_text(str(destination))
    elif arguments[0] == "detach":
        marker.unlink(missing_ok=True)
    else:
        raise ValueError("Unexpected hdiutil operation")
    return 0


def move(arguments: list[str], config: dict[str, object]) -> int:
    destination = Path(arguments[-1])
    marker = Path(str(config["root"])) / "move-failed"
    if config.get("fail_install_move") == str(destination) and not marker.exists():
        marker.touch()
        return 1
    return subprocess.call(["/bin/mv", *arguments])


def dispatch(command: str, arguments: list[str], config: dict[str, object]) -> int:
    if command == "curl":
        return download(arguments, config)
    if command == "plutil":
        return extract(arguments)
    if command == "hdiutil":
        return mount(arguments, config)
    if command == "ditto":
        if config.get("copy_failure"):
            return 1
        shutil.copytree(arguments[-2], arguments[-1], symlinks=True)
    elif command == "uname":
        print(
            config.get("system", "Darwin")
            if arguments == ["-s"]
            else config.get("machine", "arm64")
        )
    elif command == "sysctl":
        print(config.get("arm_hardware", "1"))
    elif command == "pgrep":
        return int(str(config.get("pgrep_status", 1)))
    elif command == "file":
        print(
            "ASCII text"
            if config.get("binary_failure")
            else "Mach-O 64-bit executable arm64"
        )
    elif command == "codesign":
        return int(bool(config.get("codesign_failure")))
    elif command == "mv":
        return move(arguments, config)
    else:
        raise ValueError(f"Unexpected fixture command: {command}")
    return 0


if __name__ == "__main__":
    configuration = json.loads(
        Path(os.environ["OWNLOOM_INSTALLER_FIXTURE"]).read_text()
    )
    with (Path(configuration["root"]) / "calls.jsonl").open("a") as log:
        log.write(json.dumps(sys.argv[1:]) + "\n")
    sys.exit(dispatch(sys.argv[1], sys.argv[2:], configuration))
