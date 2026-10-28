from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.release.prepare_release import prepare
from scripts.release.release import Release

TAG = "v0.1.1"
REPOSITORY = "example/Ownloom"


class PrepareReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="ownloom-release-prepare-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.write_versions("0.1.1")
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Release fixture")
        self.git("config", "user.email", "fixture@example.org")
        self.git("add", ".")
        self.git("commit", "-qm", "release fixture")
        self.commit = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.commit)
        self.calls: list[list[str]] = []
        self.response: object = {
            "ref": f"refs/tags/{TAG}",
            "object": {"type": "commit", "sha": self.commit},
        }
        self.remote_failure = False

    def git(self, *arguments: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(self.root), *arguments], text=True
        ).strip()

    def write_versions(self, version: str) -> None:
        for name in (
            "package.json",
            "apps/desktop/package.json",
            "apps/desktop/src-tauri/tauri.conf.json",
        ):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"version": version}) + "\n")
        directory = self.root / "apps/desktop/src-tauri"
        (directory / "Cargo.toml").write_text(
            f'[package]\nname = "mlx-studio"\nversion = "{version}"\n'
        )
        (directory / "Cargo.lock").write_text(
            f'version = 4\n\n[[package]]\nname = "mlx-studio"\nversion = "{version}"\n'
        )

    def command(self, arguments: list[str]) -> str:
        self.calls.append(arguments)
        if self.remote_failure:
            raise subprocess.CalledProcessError(1, ["gh", *arguments])
        return json.dumps(self.response)

    def run_prepare(self, tag: str = TAG, repository: str = REPOSITORY) -> Release:
        return prepare(self.root, repository, tag, self.command)

    def commit_changes(self) -> str:
        self.git("add", ".")
        self.git("commit", "-qm", "fixture changes")
        commit = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", commit)
        return commit

    def assert_no_local_tag(self) -> None:
        self.assertEqual(self.git("tag", "--list", TAG), "")

    def test_new_tag_is_created_once_after_checks_and_local_ref_is_removed(
        self,
    ) -> None:
        plan = self.run_prepare()
        self.assertEqual(
            (plan.tag, plan.version, plan.commit), (TAG, "0.1.1", self.commit)
        )
        self.assertEqual(
            self.calls,
            [
                [
                    "api",
                    "--method",
                    "POST",
                    f"repos/{REPOSITORY}/git/refs",
                    "--raw-field",
                    f"ref=refs/tags/{TAG}",
                    "--raw-field",
                    f"sha={self.commit}",
                ]
            ],
        )
        self.assert_no_local_tag()
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_existing_tag_uses_its_original_commit_without_remote_writes(self) -> None:
        self.git("tag", TAG)
        self.write_versions("0.2.0")
        newer = self.commit_changes()
        plan = self.run_prepare()
        self.assertEqual(plan.commit, self.commit)
        self.assertNotEqual(plan.commit, newer)
        self.assertEqual(self.git("rev-parse", f"refs/tags/{TAG}"), self.commit)
        self.assertEqual(self.calls, [])

    def test_invalid_tags_and_repository_paths_are_rejected_without_writes(
        self,
    ) -> None:
        for tag in (
            "main",
            "v01.1.0",
            "v0.1.1-preview",
            "v1２.3.4",
            "v0.1.1\nsha=other",
            "--help",
        ):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.run_prepare(tag)
        for repository in ("owner", "a/b/c", "a/b?other=1", "a/b\n", "../b", "a/.."):
            with self.subTest(repository=repository), self.assertRaises(ValueError):
                self.run_prepare(repository=repository)
        self.assertEqual(self.calls, [])
        self.assert_no_local_tag()

    def test_new_tag_requires_head_to_equal_origin_main(self) -> None:
        self.git("commit", "--allow-empty", "-qm", "unmerged commit")
        with self.assertRaisesRegex(ValueError, "origin/main"):
            self.run_prepare()
        self.assertEqual(self.calls, [])
        self.assert_no_local_tag()

    def test_dirty_tracked_and_untracked_files_are_rejected(self) -> None:
        for name in ("package.json", "untracked.txt"):
            with self.subTest(name=name):
                path = self.root / name
                previous = path.read_bytes() if path.exists() else None
                path.write_text("dirty fixture")
                with self.assertRaisesRegex(ValueError, "clean checkout"):
                    self.run_prepare()
                if previous is None:
                    path.unlink()
                else:
                    path.write_bytes(previous)
        self.assertEqual(self.calls, [])
        self.assert_no_local_tag()

    def test_manifest_mismatch_removes_temporary_tag_without_remote_writes(
        self,
    ) -> None:
        (self.root / "package.json").write_text('{"version":"0.1.2"}\n')
        self.commit_changes()
        with self.assertRaisesRegex(ValueError, "versions differ"):
            self.run_prepare()
        self.assert_no_local_tag()
        self.assertEqual(self.calls, [])

    def test_lock_mismatch_and_duplicate_local_package_are_rejected(self) -> None:
        path = self.root / "apps/desktop/src-tauri/Cargo.lock"
        original = path.read_text()
        for contents in (
            original.replace('"0.1.1"', '"0.1.0"'),
            original + '\n[[package]]\nname = "mlx-studio"\nversion = "0.1.1"\n',
        ):
            with self.subTest(contents=contents):
                path.write_text(contents)
                self.commit_changes()
                with self.assertRaisesRegex(ValueError, "Cargo.lock"):
                    self.run_prepare()
                self.assert_no_local_tag()
        self.assertEqual(self.calls, [])

    def test_existing_unmerged_tag_is_not_replaced(self) -> None:
        self.git("commit", "--allow-empty", "-qm", "unmerged commit")
        unmerged = self.git("rev-parse", "HEAD")
        self.git("tag", TAG)
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_prepare()
        self.assertEqual(self.git("rev-parse", f"refs/tags/{TAG}"), unmerged)
        self.assertEqual(self.calls, [])

    def test_existing_tag_still_requires_matching_lock(self) -> None:
        path = self.root / "apps/desktop/src-tauri/Cargo.lock"
        path.write_text(path.read_text().replace('"0.1.1"', '"0.1.0"'))
        commit = self.commit_changes()
        self.git("tag", TAG)
        with self.assertRaisesRegex(ValueError, "Cargo.lock"):
            self.run_prepare()
        self.assertEqual(self.git("rev-parse", f"refs/tags/{TAG}"), commit)
        self.assertEqual(self.calls, [])

    def test_remote_failure_is_not_retried_or_reported_as_success(self) -> None:
        self.remote_failure = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_prepare()
        self.assertEqual(len(self.calls), 1)
        self.assert_no_local_tag()

    def test_unexpected_create_response_is_rejected(self) -> None:
        for response in (
            [],
            {
                "ref": "refs/tags/v0.1.2",
                "object": {"type": "commit", "sha": self.commit},
            },
            {"ref": f"refs/tags/{TAG}", "object": {"type": "tag", "sha": self.commit}},
            {"ref": f"refs/tags/{TAG}", "object": {"type": "commit", "sha": "0" * 40}},
        ):
            with self.subTest(response=response):
                self.response = response
                before = len(self.calls)
                with self.assertRaisesRegex(ValueError, "did not confirm"):
                    self.run_prepare()
                self.assertEqual(len(self.calls), before + 1)
                self.assert_no_local_tag()


if __name__ == "__main__":
    unittest.main()
