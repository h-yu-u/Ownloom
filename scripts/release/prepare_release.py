"""Prepare an explicitly requested tag for a manual Release workflow."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tomllib
from pathlib import Path

from scripts.release.publish_release import Command, gh
from scripts.release.release import Release, release_plan, validate_checkout


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def verify_lock(root: Path, plan: Release) -> None:
    directory = root / "apps/desktop/src-tauri"
    package = tomllib.loads((directory / "Cargo.toml").read_text())["package"]
    lock = tomllib.loads((directory / "Cargo.lock").read_text())
    entries = [
        entry
        for entry in lock["package"]
        if entry["name"] == package["name"] and "source" not in entry
    ]
    if len(entries) != 1 or entries[0]["version"] != plan.version:
        raise ValueError("Cargo.lock application version differs from the release")


def create_remote_tag(repository: str, plan: Release, command: Command) -> None:
    reference = f"refs/tags/{plan.tag}"
    result = json.loads(
        command(
            [
                "api",
                "--method",
                "POST",
                f"repos/{repository}/git/refs",
                "--raw-field",
                f"ref={reference}",
                "--raw-field",
                f"sha={plan.commit}",
            ]
        )
    )
    target = result.get("object") if isinstance(result, dict) else None
    if (
        not isinstance(target, dict)
        or result.get("ref") != reference
        or target.get("type") != "commit"
        or target.get("sha") != plan.commit
    ):
        raise ValueError("GitHub did not confirm the requested release tag")


def prepare(root: Path, repository: str, tag: str, command: Command = gh) -> Release:
    if not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+", repository
    ) or repository.rsplit("/", 1)[-1] in {".", ".."}:
        raise ValueError("Repository must be owner/name")
    if not tag.isascii():
        raise ValueError("Release tag must use ASCII version digits")
    plan = release_plan(tag, git(root, "rev-parse", "HEAD"))
    if git(root, "status", "--porcelain", "--untracked-files=normal"):
        raise ValueError("Release preparation requires a clean checkout")
    reference = f"refs/tags/{tag}"
    existing = git(root, "tag", "--list", tag)
    if existing:
        git(root, "checkout", "--detach", reference)
        plan = validate_checkout(root, tag)
        verify_lock(root, plan)
        return plan
    if plan.commit != git(root, "rev-parse", "origin/main^{commit}"):
        raise ValueError("A new release tag must identify the checked-out origin/main")
    # A guarded local ref lets the existing release validator check all four
    # manifests and main ancestry before the only remote mutation. Never push it.
    git(root, "update-ref", reference, plan.commit, "0" * 40)
    try:
        plan = validate_checkout(root, tag)
        verify_lock(root, plan)
    finally:
        git(root, "update-ref", "-d", reference, plan.commit)
    create_remote_tag(repository, plan, command)
    return plan


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository")
    parser.add_argument("tag")
    arguments = parser.parse_args()
    plan = prepare(Path.cwd(), arguments.repository, arguments.tag)
    output = f"tag={plan.tag}\nversion={plan.version}\nsha={plan.commit}\n"
    if destination := os.environ.get("GITHUB_OUTPUT"):
        with Path(destination).open("a") as stream:
            stream.write(output)
    print(output, end="")


if __name__ == "__main__":
    main()
