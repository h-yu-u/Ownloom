from __future__ import annotations

import json
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.preview_release import (
    Preview,
    collect_assets,
    digest,
    preview,
    smoke_summary,
    validate_checkout,
)
from scripts.publish_preview_release import publish


def completed_smoke() -> dict[str, object]:
    return {
        "profile": "smoke",
        "status": "passed_with_scope_limits",
        "warnings": 0,
        "finishedAt": "2026-10-28T00:00:00Z",
        "signatureIntegrity": "passed (does not imply Developer ID or notarization)",
        "cycles": [{}, {}],
        "artifactSha256": "b" * 64,
        "privatePath": "/Users/private/test-data",
    }


class PreviewFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in (
            "package.json",
            "apps/desktop/package.json",
            "apps/desktop/src-tauri/tauri.conf.json",
        ):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"version":"0.1.0"}\n')
        (self.root / "apps/desktop/src-tauri/Cargo.toml").write_text(
            '[package]\nname = "fixture"\nversion = "0.1.0"\n'
        )
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Release fixture")
        self.git("config", "user.email", "fixture@example.org")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.commit = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.commit)
        self.git("tag", "v0.1.0")
        self.plan = preview("v0.1.0", self.commit)

    def git(self, *args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(self.root), *args], text=True
        ).strip()

    def assets(self) -> Path:
        app = self.root / "mounted/Ownloom.app"
        (app / "Contents").mkdir(parents=True)
        with (app / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(
                {
                    "CFBundleShortVersionString": "0.1.0",
                    "CFBundleIdentifier": "local.mlxstudio.app",
                    "CFBundleExecutable": "ownloom",
                },
                stream,
            )
        dmg = (
            self.root
            / "apps/desktop/src-tauri/target/release/bundle/dmg"
            / self.plan.dmg
        )
        dmg.parent.mkdir(parents=True)
        dmg.write_bytes(b"synthetic DMG fixture; never an installable application")
        report = self.root / "report.json"
        report.write_text(json.dumps(completed_smoke()))
        output = self.root / "public-assets"
        collect_assets(self.root, self.plan, app, report, output)
        return output


class ReleaseIdentityTests(PreviewFixture):
    def test_exact_tag_and_four_manifest_versions_are_accepted(self) -> None:
        self.assertEqual(validate_checkout(self.root, "v0.1.0"), self.plan)

    def test_unsafe_and_ambiguous_tags_are_rejected(self) -> None:
        for tag in (
            "v01.1.0",
            "v1.0",
            "v1.2.3\nsha=oops",
            "main",
            "--help",
            "v1.0.0;echo",
        ):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                preview(tag, self.commit)

    def test_tag_on_an_unmerged_branch_is_rejected(self) -> None:
        self.git("checkout", "-qb", "unmerged")
        (self.root / "new.txt").write_text("unmerged")
        self.git("add", ".")
        self.git("commit", "-qm", "unmerged")
        self.git("tag", "v0.1.1")
        with self.assertRaises(subprocess.CalledProcessError):
            validate_checkout(self.root, "v0.1.1")

    def test_checkout_that_differs_from_tag_is_rejected(self) -> None:
        self.git("commit", "--allow-empty", "-qm", "later")
        with self.assertRaisesRegex(ValueError, "Tag does not point"):
            validate_checkout(self.root, "v0.1.0")

    def test_stale_manifest_and_dirty_sources_are_rejected(self) -> None:
        (self.root / "package.json").write_text('{"version":"0.1.1"}')
        with self.assertRaisesRegex(ValueError, "versions differ"):
            validate_checkout(self.root, "v0.1.0")
        self.git("checkout", "--", "package.json")
        (self.root / "package.json").write_text('{"version":"0.1.0", "private":true}')
        with self.assertRaisesRegex(ValueError, "tracked changes"):
            validate_checkout(self.root, "v0.1.0")


class PreviewAssetsTests(PreviewFixture):
    def test_payload_is_whitelisted_and_omits_private_diagnostics(self) -> None:
        output = self.assets()
        self.assertEqual(
            {path.name for path in output.iterdir()},
            {*self.plan.files, "RELEASE_NOTES.md"},
        )
        metadata = (output / "release-metadata.json").read_text()
        self.assertNotIn("/Users/private", metadata)
        self.assertEqual(json.loads(metadata)["commit"], self.commit)
        self.assertIn(
            f"{digest(output / self.plan.dmg)}  {self.plan.dmg}",
            (output / "SHA256SUMS").read_text(),
        )
        self.assertIn("not Apple notarized", (output / "RELEASE_NOTES.md").read_text())

    def test_failed_warned_or_incomplete_smoke_cannot_publish(self) -> None:
        for changed in (
            {"status": "failed"},
            {"status": "running"},
            {"warnings": 1},
            {"cycles": [{}]},
            {"profile": "real"},
            {"artifactSha256": ""},
            {"finishedAt": None},
            {"signatureIntegrity": None},
        ):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                smoke_summary(completed_smoke() | changed)

    def test_empty_or_symbolic_release_files_are_rejected(self) -> None:
        file = self.root / "empty.dmg"
        file.touch()
        with self.assertRaises(ValueError):
            digest(file)
        target = self.root / "target.dmg"
        target.write_bytes(b"fixture")
        file.unlink()
        file.symlink_to(target)
        with self.assertRaises(ValueError):
            digest(file)


class GitHubFixture:
    def __init__(self, plan: Preview, output: Path) -> None:
        self.plan = plan
        self.output = output
        self.release: dict[str, object] | None = None
        self.calls: list[list[str]] = []
        self.corrupt_upload = False
        self.upload_failure = False

    def command(self, args: list[str]) -> str:
        self.calls.append(args)
        if args[:2] == ["api", "--paginate"]:
            return json.dumps([[self.release]] if self.release else [[]])
        if args[:2] == ["release", "create"]:
            self.release = {
                "id": 12,
                "tag_name": self.plan.tag,
                "draft": True,
                "prerelease": True,
                "target_commitish": self.plan.commit,
                "assets": [],
            }
        elif args[:2] == ["release", "upload"]:
            if self.upload_failure:
                raise subprocess.CalledProcessError(1, args)
        elif args[0] == "api":
            return json.dumps(
                [
                    {
                        "name": name,
                        "size": (self.output / name).stat().st_size,
                        "digest": "sha256:"
                        + (
                            "0" * 64
                            if self.corrupt_upload
                            else digest(self.output / name)
                        ),
                    }
                    for name in self.plan.files
                ]
            )
        elif args[:2] == ["release", "edit"]:
            return "https://github.com/example/repo/releases/tag/v0.1.0"
        else:
            raise AssertionError(args)
        return ""


class PreviewPublicationTests(PreviewFixture):
    def test_publishes_only_after_server_digests_match(self) -> None:
        output = self.assets()
        github = GitHubFixture(self.plan, output)
        url = publish("example/repo", self.plan, output, github.command)
        self.assertTrue(url.endswith("/v0.1.0"))
        writes = [args for args in github.calls if args[0] == "release"]
        self.assertEqual([args[1] for args in writes], ["create", "upload", "edit"])
        self.assertIn("--draft", writes[0])
        self.assertIn("--prerelease", writes[-1])
        self.assertIn("--latest=false", writes[-1])

    def test_partial_uploads_and_server_corruption_leave_a_draft(self) -> None:
        for failure in ("upload_failure", "corrupt_upload"):
            with self.subTest(failure=failure):
                output = self.assets()
                github = GitHubFixture(self.plan, output)
                setattr(github, failure, True)
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    publish("example/repo", self.plan, output, github.command)
                self.assertFalse(
                    any(args[:2] == ["release", "edit"] for args in github.calls)
                )
                shutil.rmtree(output)
                shutil.rmtree(self.root / "mounted")
                shutil.rmtree(self.root / "apps/desktop/src-tauri/target")

    def test_published_versions_and_unrelated_drafts_are_never_modified(self) -> None:
        output = self.assets()
        for changed in (
            {"draft": False},
            {"target_commitish": "0" * 40},
            {"prerelease": False},
        ):
            with self.subTest(changed=changed):
                github = GitHubFixture(self.plan, output)
                github.release = {
                    "id": 12,
                    "tag_name": self.plan.tag,
                    "draft": True,
                    "prerelease": True,
                    "target_commitish": self.commit,
                    "assets": [],
                } | changed
                with self.assertRaises(ValueError):
                    publish("example/repo", self.plan, output, github.command)
                self.assertFalse(any(args[0] == "release" for args in github.calls))

    def test_tampered_payload_fails_before_any_github_request(self) -> None:
        output = self.assets()
        (output / self.plan.dmg).write_bytes(b"corrupt")
        github = GitHubFixture(self.plan, output)
        with self.assertRaises(ValueError):
            publish("example/repo", self.plan, output, github.command)
        self.assertEqual(github.calls, [])

    def test_retry_of_same_commit_preview_draft_is_supported(self) -> None:
        output = self.assets()
        github = GitHubFixture(self.plan, output)
        github.command(["release", "create"])
        github.calls.clear()
        publish("example/repo", self.plan, output, github.command)
        self.assertFalse(
            any(args[:2] == ["release", "create"] for args in github.calls)
        )
