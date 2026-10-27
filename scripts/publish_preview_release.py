"""Publish only verified preview assets; published versions are never replaced."""

from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable
from pathlib import Path

from scripts.preview_release import Preview, digest, preview

Command = Callable[[list[str]], str]


def gh(args: list[str]) -> str:
    return subprocess.check_output(["gh", *args], text=True)


def release_for(
    repository: str, tag: str, command: Command
) -> dict[str, object] | None:
    pages = json.loads(
        command(
            [
                "api",
                "--paginate",
                "--slurp",
                "--header",
                "Cache-Control: no-cache",
                f"repos/{repository}/releases?per_page=100",
            ]
        )
    )
    return next(
        (item for page in pages for item in page if item["tag_name"] == tag), None
    )


def verify_local_assets(directory: Path, plan: Preview) -> dict[str, str]:
    metadata = json.loads((directory / "release-metadata.json").read_text())
    if (
        metadata.get("tag") != plan.tag
        or metadata.get("commit") != plan.commit
        or metadata.get("version") != plan.version
        or metadata.get("signing") != "ad-hoc"
        or metadata.get("notarized") is not False
    ):
        raise ValueError("Release metadata does not match the validated tag and commit")
    hashes = {name: digest(directory / name) for name in plan.files}
    expected = "".join(f"{hashes[name]}  {name}\n" for name in plan.files[:-1])
    if (directory / "SHA256SUMS").read_text() != expected:
        raise ValueError("Release checksums do not match the local assets")
    if metadata.get("dmgSha256") != hashes[plan.dmg]:
        raise ValueError("DMG checksum differs from release metadata")
    return hashes


def require_draft(release: dict[str, object], plan: Preview) -> None:
    if release.get("draft") is not True:
        raise ValueError("Version is already published; create a new version instead")
    if (
        release.get("prerelease") is not True
        or release.get("target_commitish") != plan.commit
    ):
        raise ValueError("Existing draft is not a preview for the same commit")
    assets = release.get("assets")
    if not isinstance(assets, list) or any(
        item["name"] not in plan.files for item in assets
    ):
        raise ValueError("Existing draft contains unexpected assets")


def verify_uploaded_assets(
    assets: list[dict[str, object]], hashes: dict[str, str], directory: Path
) -> None:
    actual = {item["name"]: item for item in assets}
    if (
        len(actual) != len(assets)
        or set(actual) != set(hashes)
        or any(
            actual[name].get("digest") != f"sha256:{value}"
            or actual[name].get("size") != (directory / name).stat().st_size
            for name, value in hashes.items()
        )
    ):
        raise ValueError(
            "Uploaded assets are incomplete or their hashes differ; draft retained"
        )


def create_draft(
    repository: str, plan: Preview, notes: Path, command: Command
) -> dict[str, object]:
    remote = command(
        ["api", f"repos/{repository}/commits/{plan.tag}", "--jq", ".sha"]
    ).strip()
    if remote != plan.commit:
        raise ValueError("Remote tag no longer identifies the tested commit")
    args = ["api", "--method", "POST", f"repos/{repository}/releases"]
    values = {
        "tag_name": plan.tag,
        "target_commitish": plan.commit,
        "name": f"Ownloom {plan.tag} — Preview",
        "make_latest": "false",
    }
    for name, value in values.items():
        args.extend(["--raw-field", f"{name}={value}"])
    args.extend(["--field", "draft=true", "--field", "prerelease=true"])
    args.extend(["--field", f"body=@{notes}"])
    release = json.loads(command(args))
    if not isinstance(release, dict) or release.get("tag_name") != plan.tag:
        raise ValueError("Create release returned an unexpected response")
    return release


def publish(
    repository: str, plan: Preview, directory: Path, command: Command = gh
) -> str:
    hashes = verify_local_assets(directory, plan)
    notes = directory / "RELEASE_NOTES.md"
    digest(notes)
    release = release_for(repository, plan.tag, command)
    common = ["--repo", repository]
    if release is None:
        release = create_draft(repository, plan, notes, command)
    require_draft(release, plan)
    command(
        [
            "release",
            "upload",
            plan.tag,
            *common,
            *(str(directory / name) for name in plan.files),
            "--clobber",
        ]
    )
    assets = json.loads(
        command(["api", f"repos/{repository}/releases/{release['id']}/assets"])
    )
    verify_uploaded_assets(assets, hashes, directory)
    return command(
        [
            "release",
            "edit",
            plan.tag,
            *common,
            "--draft=false",
            "--prerelease",
            "--latest=false",
            "--notes-file",
            str(notes),
        ]
    ).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository")
    parser.add_argument("tag")
    parser.add_argument("commit")
    args = parser.parse_args()
    print(
        publish(
            args.repository,
            preview(args.tag, args.commit),
            Path(".build/preview-release"),
        )
    )


if __name__ == "__main__":
    main()
