"""Exercise the installer with real macOS tools in an isolated temporary directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from scripts.acceptance.installer_fixture import InstallerFixture

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/release/install.sh"
DMG = "ownloom-darwin-arm64.dmg"


def run(*arguments: str) -> str:
    result = subprocess.run(
        arguments, text=True, capture_output=True, timeout=120, check=False
    )
    if result.returncode:
        raise RuntimeError(f"{arguments[0]} failed: {result.stderr[-4000:]}")
    return result.stdout


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fixture_assets(root: Path) -> Path:
    app = root / "fixture-app/Ownloom.app"
    binary = app / "Contents/MacOS/ownloom"
    binary.parent.mkdir(parents=True)
    source = root / "fixture.c"
    source.write_text("int main(void) { return 0; }\n")
    run("cc", "-arch", "arm64", "-Os", str(source), "-o", str(binary))
    (app / "Contents/Info.plist").write_bytes(
        plistlib.dumps(
            {
                "CFBundleIdentifier": "local.mlxstudio.app",
                "CFBundleExecutable": "ownloom",
                "CFBundleShortVersionString": "0.1.1",
                "CFBundleVersion": "0.1.1",
                "CFBundlePackageType": "APPL",
            }
        )
    )
    run("codesign", "--force", "--sign", "-", "--timestamp=none", str(app))
    assets = root / "assets"
    assets.mkdir()
    run(
        "hdiutil",
        "create",
        "-volname",
        "Ownloom",
        "-srcfolder",
        str(app.parent),
        "-format",
        "UDZO",
        str(assets / DMG),
    )
    (assets / "release-metadata.json").write_text(
        json.dumps(
            {
                "tag": "v0.1.1",
                "version": "0.1.1",
                "platform": "macOS",
                "architecture": "aarch64",
                "signing": "ad-hoc",
                "notarized": False,
                "dmgSha256": digest(assets / DMG),
            }
        )
    )
    shutil.copyfile(SCRIPT, assets / "install.sh")
    (assets / "SHA256SUMS").write_text(
        "".join(
            f"{digest(assets / name)}  {name}\n"
            for name in (DMG, "release-metadata.json", "install.sh")
        )
    )
    return assets


def invoke(
    fixture: InstallerFixture, script: Path, target: Path, *extra: str
) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        ["/bin/sh", str(script), "--install-dir", str(target), *extra],
        env=fixture.environment,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=300)
        return subprocess.CompletedProcess(
            process.args, process.returncode, stdout, stderr
        )
    except BaseException:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate(timeout=5)
        raise


def require_success(result: subprocess.CompletedProcess[str]) -> None:
    if result.returncode:
        raise RuntimeError(
            f"Installer failed ({result.returncode}): {result.stderr[-6000:]}"
        )


def mounted_directories(root: Path) -> list[str]:
    info = plistlib.loads(run("hdiutil", "info", "-plist").encode())
    return [
        entity["mount-point"]
        for image in info.get("images", [])
        for entity in image.get("system-entities", [])
        if str(entity.get("mount-point", "")).startswith(f"{root}/")
    ]


def exercise(root: Path, assets: Path, complete_app: bool) -> dict[str, object]:
    script = assets / "install.sh"
    if script.read_bytes() != SCRIPT.read_bytes():
        raise ValueError("Release installer differs from the checked-out source")
    metadata = json.loads((assets / "release-metadata.json").read_text())
    fixture = InstallerFixture(root / "transport", assets)
    target = root / "Applications with spaces"
    target.mkdir()
    app = target / "Ownloom.app"
    require_success(invoke(fixture, script, target))
    run("codesign", "--verify", "--deep", "--strict", str(app))
    if complete_app:
        for relative in (
            "Contents/MacOS/mlx-studio-runtime",
            "Contents/Resources/coding-agent/bin/node",
        ):
            if not (app / relative).is_file():
                raise ValueError(f"Installed release is missing {relative}")
    legacy = app / "legacy-install-marker.txt"
    legacy.write_text("must disappear on replacement")
    require_success(invoke(fixture, script, target, "--version", metadata["tag"]))
    if legacy.exists():
        raise ValueError(
            "Installer merged the previous application instead of replacing it"
        )
    run("codesign", "--verify", "--deep", "--strict", str(app))
    before = digest(app / "Contents/MacOS/ownloom")
    fixture.update(corrupt_download=DMG)
    rejected = invoke(fixture, script, target, "--version", metadata["tag"])
    if rejected.returncode == 0 or digest(app / "Contents/MacOS/ownloom") != before:
        raise ValueError("A damaged download changed the installed application")
    run("codesign", "--verify", "--deep", "--strict", str(app))
    if list((fixture.root / "temporary").iterdir()) or list(target.iterdir()) != [app]:
        raise ValueError("Installer left staging or download files behind")
    if mounted_directories(root):
        raise ValueError("Installer left a disk image mounted")
    return {
        "firstInstall": "passed",
        "replacement": "passed",
        "checksumFailurePreservesApp": "passed",
        "signatureIntegrity": "passed (not Developer ID or notarization)",
        "temporaryFilesAndMounts": "passed",
    }


def verify(assets: Path | None, output: Path) -> None:
    if sys.platform != "darwin":
        raise RuntimeError("Installer acceptance requires macOS")
    report: dict[str, object] = {
        "schemaVersion": 1,
        "status": "failed",
        "scope": "release DMG" if assets else "synthetic signed macOS app and DMG",
        "transport": "local release fixture; no external download",
        "unverified": [
            "native GUI",
            "Gatekeeper",
            "Developer ID/notarization",
            "real-model inference",
            "public GitHub download",
        ],
    }
    try:
        with tempfile.TemporaryDirectory(
            prefix="ownloom-installer-acceptance-"
        ) as directory:
            root = Path(directory).resolve()
            try:
                source = assets.resolve() if assets else fixture_assets(root)
                report["dmgSha256"] = digest(source / DMG)
                report["installerSha256"] = digest(source / "install.sh")
                report["checks"] = exercise(root, source, assets is not None)
            finally:
                for mount in mounted_directories(root):
                    run("hdiutil", "detach", mount)
        report["status"] = "passed"
    finally:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--assets",
        type=Path,
        help="Collected release assets; omit to build a small signed fixture",
    )
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    verify(options.assets, options.output)
