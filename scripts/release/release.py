"""Validate release identity and prepare a small, public release payload."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path

TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
SHA = re.compile(r"[0-9a-f]{40}")


@dataclass(frozen=True)
class Release:
    tag: str
    version: str
    commit: str

    @property
    def title(self) -> str:
        return f"Ownloom {self.tag}"

    @property
    def dmg(self) -> str:
        return "ownloom-darwin-arm64.dmg"

    @property
    def files(self) -> tuple[str, ...]:
        return self.dmg, "install.sh", "release-metadata.json", "SHA256SUMS"


def release_plan(tag: str, commit: str) -> Release:
    if not TAG.fullmatch(tag):
        raise ValueError(
            "Release tag must be vMAJOR.MINOR.PATCH without leading zeroes"
        )
    if not SHA.fullmatch(commit):
        raise ValueError("Release commit must be a full Git SHA")
    return Release(tag, tag[1:], commit)


def digest(path: Path) -> str:
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"Missing, empty or symbolic-link release file: {path.name}")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_checkout(root: Path, tag: str) -> Release:
    def git(*args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(root), *args], text=True
        ).strip()

    plan = release_plan(tag, git("rev-parse", "HEAD"))
    if git("rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}") != plan.commit:
        raise ValueError("Tag does not point to the checked-out commit")
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "merge-base",
            "--is-ancestor",
            plan.commit,
            "origin/main",
        ],
        check=True,
    )
    versions = {
        path: json.loads((root / path).read_text())["version"]
        for path in (
            "package.json",
            "apps/desktop/package.json",
            "apps/desktop/src-tauri/tauri.conf.json",
        )
    }
    cargo = root / "apps/desktop/src-tauri/Cargo.toml"
    versions[str(cargo.relative_to(root))] = tomllib.loads(cargo.read_text())[
        "package"
    ]["version"]
    if any(version != plan.version for version in versions.values()):
        raise ValueError(f"Tag and application versions differ: {versions}")
    if git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Release checkout has tracked changes")
    return plan


def smoke_summary(report: dict[str, object]) -> dict[str, object]:
    if (
        report.get("profile") != "smoke"
        or report.get("status") != "passed_with_scope_limits"
        or report.get("warnings") != 0
        or not report.get("finishedAt")
        or report.get("signatureIntegrity")
        != "passed (does not imply Developer ID or notarization)"
    ):
        raise ValueError("Packaged smoke acceptance did not finish without warnings")
    cycles = report.get("cycles")
    artifact = report.get("artifactSha256")
    if not isinstance(cycles, list) or len(cycles) < 2:
        raise ValueError(
            "Packaged smoke acceptance requires at least two completed cycles"
        )
    if not isinstance(artifact, str) or not re.fullmatch(r"[0-9a-f]{64}", artifact):
        raise ValueError("Packaged smoke acceptance has no application fingerprint")
    return {
        "profile": "smoke",
        "status": report["status"],
        "cycles": len(cycles),
        "appSha256": artifact,
    }


def collect_assets(
    root: Path, plan: Release, app: Path, report_path: Path, output: Path
) -> None:
    report = json.loads(report_path.read_text())
    summary = smoke_summary(report)
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if (
        info.get("CFBundleShortVersionString") != plan.version
        or info.get("CFBundleIdentifier") != "local.mlxstudio.app"
        or info.get("CFBundleExecutable") != "ownloom"
    ):
        raise ValueError("Packaged app identity does not match the release")
    dmg = (
        root
        / "apps/desktop/src-tauri/target/release/bundle/dmg"
        / f"Ownloom_{plan.version}_aarch64.dmg"
    )
    dmg_digest = digest(dmg)
    installer = root / "scripts/release/install.sh"
    digest(installer)
    metadata = {
        "tag": plan.tag,
        "version": plan.version,
        "commit": plan.commit,
        "platform": "macOS",
        "architecture": "aarch64",
        "signing": "ad-hoc",
        "notarized": False,
        "dmgSha256": dmg_digest,
        "acceptance": summary,
        "unverified": [
            "real-model inference",
            "native GUI/Gatekeeper",
            "independent clean Mac",
        ],
    }
    output.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(dmg, output / plan.dmg)
    shutil.copyfile(installer, output / "install.sh")
    (output / "release-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    hashes = [f"{digest(output / name)}  {name}\n" for name in plan.files[:-1]]
    (output / "SHA256SUMS").write_text("".join(hashes))
    (output / "RELEASE_NOTES.md").write_text(
        f"# {plan.title}\n\n"
        "Apple Silicon macOS only. Model weights are downloaded separately.\n"
        "This build is ad-hoc signed and is not Apple notarized. macOS may require manual "
        "approval in Privacy & Security. Do not disable Gatekeeper globally.\n\n"
        "仅支持 Apple Silicon macOS，模型权重需另行下载。"
        "本版本使用临时签名，未经过 Apple 公证；安装时可能需要在「隐私与安全性」中手动允许。"
        "请勿全局关闭 Gatekeeper。\n\n"
        f"Source commit / 源码提交: {plan.commit}\n\n"
        "Automated source checks, tests and packaged smoke checks passed. "
        "Real-model inference, native GUI and independent clean-machine acceptance remain "
        "unverified for this build.\n\n"
        "源码检查、自动化测试和包内启动检查通过；本制品的真实模型、原生界面与独立干净机器"
        "验收仍未验证。\n\n"
        "## Install / 安装\n\n"
        f"Download `{plan.dmg}`, open it and drag Ownloom to Applications. "
        "Then open Ownloom and choose a compatible model in Models.\n\n"
        f"下载 `{plan.dmg}`，打开后将 Ownloom 拖入「应用程序」。"
        "打开 Ownloom，在「模型库」下载或导入兼容模型，即可开始使用。\n\n"
        "Or install from Terminal / 也可通过终端安装：\n\n"
        "```sh\n"
        "curl -fsSL https://github.com/h-yu-u/Ownloom/releases/latest/download/install.sh | sh\n"
        "```\n\n"
        "Verify all downloaded release files / 下载全部附件后校验：\n\n"
        "    shasum -a 256 -c SHA256SUMS\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "collect"])
    parser.add_argument("tag")
    parser.add_argument("--commit")
    parser.add_argument("--app", type=Path)
    args = parser.parse_args()
    root = Path.cwd()
    if args.command == "validate":
        plan = validate_checkout(root, args.tag)
        values = f"tag={plan.tag}\nversion={plan.version}\nsha={plan.commit}\n"
        if output := os.environ.get("GITHUB_OUTPUT"):
            with Path(output).open("a") as stream:
                stream.write(values)
        print(values, end="")
    else:
        plan = release_plan(args.tag, args.commit or "")
        if args.app is None:
            parser.error(
                "collect requires --app pointing to the mounted DMG application"
            )
        collect_assets(
            root,
            plan,
            args.app,
            root / ".build/release-acceptance/report.json",
            root / ".build/release",
        )


if __name__ == "__main__":
    main()
