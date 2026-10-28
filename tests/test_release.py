from __future__ import annotations

import json
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.release.publish_release import publish
from scripts.release.release import (
    Release,
    collect_assets,
    digest,
    release_plan,
    smoke_summary,
    validate_checkout,
)


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


class ReleaseFixture(unittest.TestCase):
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
        installer = self.root / "scripts/release/install.sh"
        installer.parent.mkdir(parents=True)
        installer.write_text("#!/bin/sh\n# Isolated release payload fixture.\nexit 0\n")
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Release fixture")
        self.git("config", "user.email", "fixture@example.org")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.commit = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.commit)
        self.git("tag", "v0.1.0")
        self.plan = release_plan("v0.1.0", self.commit)

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
            / "Ownloom_0.1.0_aarch64.dmg"
        )
        dmg.parent.mkdir(parents=True)
        dmg.write_bytes(b"synthetic DMG fixture; never an installable application")
        report = self.root / "report.json"
        report.write_text(json.dumps(completed_smoke()))
        output = self.root / "public-assets"
        collect_assets(self.root, self.plan, app, report, output)
        return output


class ReleaseIdentityTests(ReleaseFixture):
    def test_exact_tag_and_four_manifest_versions_are_accepted(self) -> None:
        self.assertEqual(validate_checkout(self.root, "v0.1.0"), self.plan)

    def test_unsafe_and_ambiguous_tags_are_rejected(self) -> None:
        for tag in (
            "v01.1.0",
            "v1２.3.4",
            "v1.0",
            "v1.2.3\nsha=oops",
            "main",
            "--help",
            "v1.0.0;echo",
        ):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release_plan(tag, self.commit)

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


class ReleaseAssetsTests(ReleaseFixture):
    def test_payload_is_whitelisted_and_omits_private_diagnostics(self) -> None:
        output = self.assets()
        self.assertEqual(
            {path.name for path in output.iterdir()},
            {
                "ownloom-darwin-arm64.dmg",
                "install.sh",
                "release-metadata.json",
                "SHA256SUMS",
                "RELEASE_NOTES.md",
            },
        )
        bundled_dmg = (
            self.root
            / "apps/desktop/src-tauri/target/release/bundle/dmg"
            / "Ownloom_0.1.0_aarch64.dmg"
        )
        public_dmg = output / "ownloom-darwin-arm64.dmg"
        self.assertEqual(public_dmg.read_bytes(), bundled_dmg.read_bytes())
        self.assertEqual(
            (output / "install.sh").read_bytes(),
            (self.root / "scripts/release/install.sh").read_bytes(),
        )
        self.assertIn(
            f"{digest(output / 'install.sh')}  install.sh",
            (output / "SHA256SUMS").read_text(),
        )
        metadata = (output / "release-metadata.json").read_text()
        self.assertNotIn("/Users/private", metadata)
        self.assertEqual(json.loads(metadata)["commit"], self.commit)
        self.assertEqual(json.loads(metadata)["dmgSha256"], digest(public_dmg))
        self.assertIn(
            f"{digest(public_dmg)}  ownloom-darwin-arm64.dmg",
            (output / "SHA256SUMS").read_text(),
        )
        notes = (output / "RELEASE_NOTES.md").read_text()
        self.assertTrue(notes.startswith("# Ownloom v0.1.0\n\n"))
        self.assertNotIn("Preview", notes)
        self.assertNotIn("预览版", notes)
        self.assertIn("not Apple notarized", notes)
        self.assertIn("unverified for this build", notes)
        self.assertIn("releases/latest/download/install.sh | sh", notes)

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
    def __init__(self, plan: Release, output: Path) -> None:
        self.plan = plan
        self.output = output
        self.release: dict[str, object] | None = None
        self.calls: list[list[str]] = []
        self.corrupt_upload = False
        self.upload_failure = False
        self.hide_drafts = False
        self.latest = False

    def draft(self) -> dict[str, object]:
        return {
            "id": 12,
            "tag_name": self.plan.tag,
            "name": f"Ownloom {self.plan.tag}",
            "draft": True,
            "prerelease": False,
            "target_commitish": self.plan.commit,
            "assets": [],
        }

    def command(self, args: list[str]) -> str:
        self.calls.append(args)
        if args[:2] == ["api", "--paginate"]:
            return json.dumps(
                [[self.release]] if self.release and not self.hide_drafts else [[]]
            )
        if args[:3] == ["api", "--method", "POST"]:
            self.release = self.draft()
            fields = {
                args[index + 1].split("=", 1)[0]: args[index + 1].split("=", 1)[1]
                for index, argument in enumerate(args[:-1])
                if argument in {"--raw-field", "--field"}
            }
            self.release.update(
                name=fields["name"],
                draft=fields["draft"] == "true",
                prerelease=fields["prerelease"] == "true",
            )
            self.latest = fields["make_latest"] == "true"
            return json.dumps(self.release)
        if args[0] == "api" and "/commits/" in args[1]:
            return self.plan.commit
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
            assert self.release is not None
            self.release["draft"] = "--draft=false" not in args
            self.release["prerelease"] = "--prerelease=false" not in args
            self.latest = "--latest" in args
            if "--title" in args:
                self.release["name"] = args[args.index("--title") + 1]
            return "https://github.com/example/repo/releases/tag/v0.1.0"
        else:
            raise AssertionError(args)
        return ""


class ReleasePublicationTests(ReleaseFixture):
    def test_new_draft_does_not_require_immediate_list_visibility(self) -> None:
        output = self.assets()
        github = GitHubFixture(self.plan, output)
        github.hide_drafts = True
        url = publish("example/repo", self.plan, output, github.command)
        self.assertTrue(url.endswith("/v0.1.0"))

    def test_publishes_only_after_server_digests_match(self) -> None:
        output = self.assets()
        github = GitHubFixture(self.plan, output)
        url = publish("example/repo", self.plan, output, github.command)
        self.assertTrue(url.endswith("/v0.1.0"))
        writes = [args for args in github.calls if args[0] == "release"]
        self.assertEqual([args[1] for args in writes], ["upload", "edit"])
        create = next(
            args for args in github.calls if args[:3] == ["api", "--method", "POST"]
        )
        self.assertIn("draft=true", create)
        self.assertIn("prerelease=false", create)
        self.assertIn("make_latest=false", create)
        self.assertIn("name=Ownloom v0.1.0", create)
        self.assertIn("--draft=false", writes[-1])
        self.assertIn("--prerelease=false", writes[-1])
        self.assertIn("--latest", writes[-1])
        self.assertIsNotNone(github.release)
        self.assertFalse(github.release["draft"])
        self.assertFalse(github.release["prerelease"])
        self.assertEqual(github.release["name"], "Ownloom v0.1.0")
        self.assertTrue(github.latest)

    def test_partial_uploads_and_server_corruption_leave_a_draft(self) -> None:
        output = self.assets()
        for failure in ("upload_failure", "corrupt_upload"):
            with self.subTest(failure=failure):
                github = GitHubFixture(self.plan, output)
                setattr(github, failure, True)
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    publish("example/repo", self.plan, output, github.command)
                self.assertFalse(
                    any(args[:2] == ["release", "edit"] for args in github.calls)
                )
                self.assertIsNotNone(github.release)
                self.assertTrue(github.release["draft"])
                self.assertFalse(github.release["prerelease"])
                self.assertFalse(github.latest)

    def test_published_versions_and_unrelated_drafts_are_never_modified(self) -> None:
        output = self.assets()
        for changed in (
            {"draft": False},
            {"target_commitish": "0" * 40},
            {"prerelease": True},
            {"prerelease": None},
        ):
            with self.subTest(changed=changed):
                github = GitHubFixture(self.plan, output)
                github.release = github.draft() | changed
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

    def test_tampered_installer_fails_before_any_github_request(self) -> None:
        output = self.assets()
        (output / "install.sh").write_text("#!/bin/sh\nexit 1\n")
        github = GitHubFixture(self.plan, output)
        with self.assertRaises(ValueError):
            publish("example/repo", self.plan, output, github.command)
        self.assertEqual(github.calls, [])

    def test_retry_of_same_commit_release_draft_is_supported(self) -> None:
        output = self.assets()
        github = GitHubFixture(self.plan, output)
        github.release = github.draft()
        github.release["name"] = "Unfinished release"
        publish("example/repo", self.plan, output, github.command)
        self.assertFalse(
            any(args[:3] == ["api", "--method", "POST"] for args in github.calls)
        )
        self.assertEqual(github.release["name"], "Ownloom v0.1.0")
        self.assertFalse(github.release["draft"])
        self.assertFalse(github.release["prerelease"])
        self.assertTrue(github.latest)
