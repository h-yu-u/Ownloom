import copy
import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest.mock import patch

from test_runtime_artifact_fixtures import ArtifactFixture, FakeGitHub

from scripts.build.runtime_artifact_policy import SIDECAR, TARGET
from scripts.release.restore_runtime import main, restore_runtime, terminate
from scripts.release.runtime_artifact_source import GitHub, Unavailable, read_command


class RuntimeRestoreTests(ArtifactFixture):
    def setUp(self):
        super().setUp()
        self.create()
        self.github = FakeGitHub(self)
        self.previous = b"previous target must survive every fallback"
        (self.root / TARGET).write_bytes(self.previous)

    def restore(self):
        return restore_runtime(
            self.root, self.source.repository, self.commit, self.github
        )

    def assert_fallback(self):
        result = self.restore()
        self.assertFalse(result.restored, result)
        self.assertEqual((self.root / TARGET).read_bytes(), self.previous)
        self.assertEqual(
            set((self.root / TARGET).parent.iterdir()), {self.root / TARGET}
        )
        self.assertTrue(
            all(not path.parent.exists() for path in self.github.downloaded)
        )
        return result

    def test_same_commit_success_installs_verified_bytes_executable_atomically(self):
        result = self.restore()
        self.assertTrue(result.restored, result)
        self.assertEqual((self.root / TARGET).read_bytes(), self.binary)
        self.assertEqual((self.root / TARGET).stat().st_mode & 0o777, 0o755)
        self.assertTrue(
            all(not path.parent.exists() for path in self.github.downloaded)
        )
        self.assertTrue(self.github.calls[-1].endswith("/runs/101"))

    def test_wrong_run_identity_event_branch_attempt_or_completion_cannot_restore(self):
        original = copy.deepcopy(self.github.run)
        changes = (
            {"head_sha": "f" * 40},
            {"event": "pull_request"},
            {"event": "workflow_dispatch"},
            {"head_branch": "feature"},
            {"path": ".github/workflows/other.yml"},
            {"workflow_id": 99},
            {"status": "in_progress"},
            {"conclusion": "failure"},
            {"run_attempt": 1},
            {"run_attempt": True},
            {"repository": {"id": 7, "full_name": "other/repo"}},
            {"head_repository": {"id": 8, "full_name": "other/fork"}},
        )
        for changed in changes:
            with self.subTest(changed=changed):
                self.github.run = original | changed
                self.assert_fallback()
                self.assertFalse(self.github.downloaded)

    def test_artifact_source_expiry_name_and_missing_archive_digest_fail_closed(self):
        original = copy.deepcopy(self.github.artifact)
        changes = [
            {"expired": True},
            {"expired": None},
            {"digest": None},
            {"name": f"runtime-release-{self.commit}-1"},
            {"size_in_bytes": 2**40},
        ]
        for key, value in (
            ("id", 102),
            ("head_sha", "0" * 40),
            ("head_branch", "other"),
            ("repository_id", 8),
            ("head_repository_id", 8),
        ):
            changes.append({"workflow_run": original["workflow_run"] | {key: value}})
        for changed in changes:
            with self.subTest(changed=changed):
                self.github.artifact = original | changed
                self.assert_fallback()
                self.assertFalse(self.github.downloaded)

    def test_unknown_workflow_or_unbounded_metadata_is_a_miss(self):
        self.github.workflow["path"] = ".github/workflows/untrusted.yml"
        self.assert_fallback()
        self.github.workflow["path"] = ".github/workflows/ci.yml"
        original = self.github.json

        def oversized(endpoint):
            result = original(endpoint)
            if "workflow_runs" in result:
                result["total_count"] = 51
            return result

        with patch.object(self.github, "json", side_effect=oversized):
            self.assert_fallback()
        self.assertFalse(self.github.downloaded)

    def test_archive_digest_corruption_is_rejected_before_extraction(self):
        self.github.archive.write_bytes(
            self.github.archive.read_bytes() + b"corruption"
        )
        with patch("scripts.release.restore_runtime.extract_archive") as extract:
            result = self.assert_fallback()
        extract.assert_not_called()
        self.assertIn("archive digest", result.reason)

    def test_binary_digest_and_manifest_attempt_mismatch_are_rejected(self):
        sidecar = self.output / SIDECAR
        sidecar.write_bytes(self.binary[:-1] + b"!")
        self.github.repack()
        self.assertIn("binary digest", self.assert_fallback().reason)
        sidecar.write_bytes(self.binary)
        manifest = self.output / "manifest.json"
        data = json.loads(manifest.read_text())
        manifest.write_text(json.dumps(data | {"runAttempt": 1}))
        self.github.repack()
        self.assert_fallback()

    def test_extra_traversal_duplicate_and_symbolic_zip_entries_are_rejected(self):
        for entry in (
            "../escape",
            "/absolute",
            "nested/file",
            "manifest.json",
            "extra",
        ):
            with self.subTest(entry=entry):
                self.github.repack()
                with (
                    warnings.catch_warnings(),
                    zipfile.ZipFile(self.github.archive, "a") as archive,
                ):
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr(entry, b"not allowed")
                self.github.update_digest()
                self.assert_fallback()
        self.github.repack()
        with zipfile.ZipFile(self.github.archive, "w") as archive:
            archive.write(self.output / "manifest.json", "manifest.json")
            entry = zipfile.ZipInfo(SIDECAR)
            entry.create_system = 3
            entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(entry, b"../elsewhere")
        self.github.update_digest()
        self.assert_fallback()
        self.assertFalse((self.root / "escape").exists())

    def test_manifest_limits_and_python_image_input_changes_trigger_fallback(self):
        manifest = self.output / "manifest.json"
        original = manifest.read_bytes()
        manifest.write_bytes(b" " * (64 * 1024 + 1))
        self.github.repack()
        self.assert_fallback()
        manifest.write_bytes(original)
        self.github.repack()
        with patch.dict(os.environ, {"ImageVersion": "different"}):
            self.assert_fallback()
        with patch(
            "scripts.build.runtime_artifact_policy.platform.python_version",
            return_value="3.12.13",
        ):
            self.assert_fallback()
        (self.root / "README.md").write_text("dirty outside build inputs\n")
        self.assert_fallback()

    def test_changed_attempt_after_download_and_api_failure_preserve_target(self):
        self.github.after_download = lambda: self.github.run.update(run_attempt=3)
        self.assert_fallback()
        self.github.after_download = None
        self.github.error = subprocess.CalledProcessError(
            1, ["gh"], stderr="secret signed URL"
        )
        result = self.assert_fallback()
        self.assertNotIn("secret", result.reason)

    def test_existing_target_symlink_and_atomic_install_failure_preserve_prior_file(
        self,
    ):
        target = self.root / TARGET
        other = self.root / ".build/previous"
        other.write_bytes(self.previous)
        target.unlink()
        target.symlink_to(other)
        self.assert_fallback()
        self.assertTrue(target.is_symlink())
        target.unlink()
        target.write_bytes(self.previous)
        with patch(
            "scripts.release.restore_runtime.os.replace",
            side_effect=OSError("fixture failure"),
        ):
            self.assert_fallback()

    def test_interruptions_propagate_and_remove_downloads(self):
        def interrupted():
            raise KeyboardInterrupt()

        self.github.after_download = interrupted
        with self.assertRaises(KeyboardInterrupt):
            self.restore()
        self.assertEqual((self.root / TARGET).read_bytes(), self.previous)
        self.assertTrue(
            all(not path.parent.exists() for path in self.github.downloaded)
        )
        with self.assertRaises(SystemExit) as stopped:
            terminate(signal.SIGTERM, None)
        self.assertEqual(stopped.exception.code, 128 + signal.SIGTERM)

    def test_cli_outputs_boolean_and_does_not_print_remote_error_details(self):
        output = self.root / ".build/output.txt"
        self.github.error = OSError("sensitive signed URL")
        with (
            patch("scripts.release.restore_runtime.GitHub", return_value=self.github),
            patch("scripts.release.restore_runtime.Path.cwd", return_value=self.root),
            patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}),
            patch.object(
                sys,
                "argv",
                [
                    "restore",
                    "--repository",
                    self.source.repository,
                    "--commit",
                    self.commit,
                ],
            ),
            patch("scripts.release.restore_runtime.signal.signal"),
            patch("builtins.print") as printed,
        ):
            main()
        self.assertEqual(output.read_text(), "restored=false\n")
        self.assertNotIn("sensitive", str(printed.call_args))


class GitHubReadTests(unittest.TestCase):
    def test_only_get_fixed_host_and_constructed_download_route_are_used(self):
        client = GitHub()
        with patch("scripts.release.runtime_artifact_source.read_command") as command:
            client.download("example/ownloom", 30, Path("not-created"), 123)
        args, _, maximum, _ = command.call_args.args
        self.assertEqual(
            args[:6], ["gh", "api", "--hostname", "github.com", "--method", "GET"]
        )
        self.assertEqual(args[-1], "repos/example/ownloom/actions/artifacts/30/zip")
        self.assertEqual(maximum, 123)

    def test_streamed_read_is_bounded_and_child_is_reaped(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bytes"
            args = [
                sys.executable,
                "-c",
                "import sys; sys.stdout.buffer.write(b'x' * 4096)",
            ]
            with self.assertRaisesRegex(Unavailable, "limit"):
                read_command(args, path, 10, 5)
            self.assertLessEqual(path.stat().st_size, 10)

    def test_child_signal_is_a_download_failure_without_cancelling_parent(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bytes"
            args = [
                sys.executable,
                "-c",
                "import os, signal; os.kill(os.getpid(), signal.SIGKILL)",
            ]
            with self.assertRaisesRegex(Unavailable, "API request failed"):
                read_command(args, path, 100, 5)
