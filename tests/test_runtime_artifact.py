import json
import os
from dataclasses import replace
from unittest.mock import patch

from test_runtime_artifact_fixtures import ArtifactFixture

from scripts.build.runtime_artifact import create_artifact, verify_directory
from scripts.build.runtime_artifact_policy import (
    SIDECAR,
    TARGET,
    expected_manifest,
    input_digest,
    read_manifest,
)


class RuntimeArtifactTests(ArtifactFixture):
    def test_round_trip_binds_source_tools_image_and_actual_bytes(self):
        manifest = self.create()
        self.assertEqual(
            {item.name for item in self.output.iterdir()}, {"manifest.json", SIDECAR}
        )
        self.assertEqual(manifest["commit"], self.commit)
        self.assertEqual(manifest["runAttempt"], 2)
        self.assertEqual(manifest["toolchain"]["pyinstaller"], "6.16.0")
        self.assertEqual(manifest["runnerImage"]["version"], "20261020.1")
        verify_directory(self.output, expected_manifest(self.root, self.source))
        self.assertEqual((self.output / SIDECAR).read_bytes(), self.binary)
        self.assertEqual((self.output / SIDECAR).stat().st_mode & 0o777, 0o644)

    def test_tracked_changes_inside_outside_inputs_and_index_are_rejected(self):
        for name, staged in (
            ("services/runtime/src/entry.py", False),
            ("README.md", False),
            ("README.md", True),
        ):
            with self.subTest(name=name, staged=staged):
                (self.root / name).write_text("changed\n")
                if staged:
                    self.git("add", name)
                with self.assertRaisesRegex(ValueError, "tracked changes"):
                    self.create()
                self.assertFalse(self.output.exists())
                self.git("reset", "--hard", "HEAD")

    def test_wrong_head_and_untracked_runtime_sources_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "commit differs"):
            create_artifact(
                self.root, self.output, replace(self.source, commit="b" * 40)
            )
        (self.root / "services/runtime/src/untracked.py").write_text("changed\n")
        with self.assertRaisesRegex(ValueError, "not clean"):
            self.create()

    def test_source_and_build_policy_change_fingerprints(self):
        original = input_digest(self.root, self.commit)
        for name in (
            "services/runtime/src/entry.py",
            "scripts/build/runtime_bundle.py",
        ):
            (self.root / name).write_text("changed\n")
            self.git("add", name)
            self.git("commit", "-qm", "changed fixture input")
            self.assertNotEqual(
                input_digest(self.root, self.git("rev-parse", "HEAD")), original
            )

    def test_incorrect_installed_tools_profile_or_report_fail_closed(self):
        with (
            patch(
                "scripts.build.runtime_artifact_policy.importlib.metadata.version",
                return_value="wrong",
            ),
            self.assertRaisesRegex(ValueError, "differs from lock"),
        ):
            self.create()
        report = self.root / ".build/runtime/archive-size.json"
        original = json.loads(report.read_text())
        for change in (
            {"profile": "fake"},
            {"boundary_status": "failed"},
            {"sidecar": {}},
        ):
            report.write_text(json.dumps(original | change))
            with self.assertRaisesRegex(ValueError, "build report"):
                self.create()
            self.assertFalse(self.output.exists())

    def test_manifest_rejects_wrong_identity_tools_image_and_duplicate_fields(self):
        manifest = self.create()
        expected = expected_manifest(self.root, self.source)
        for key, value in (
            ("repository", "other/repo"),
            ("commit", "f" * 40),
            ("runId", 102),
            ("runAttempt", 1),
            ("profile", "fake"),
            ("schemaVersion", True),
            ("inputsSha256", "0" * 64),
            ("toolchain", {}),
            ("runnerImage", {}),
            ("platform", {"system": "Darwin", "architecture": "x86_64"}),
        ):
            with self.subTest(key=key), self.assertRaises(ValueError):
                read_manifest(json.dumps(manifest | {key: value}).encode(), expected)
        duplicate = json.dumps(manifest).replace(
            '"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'
        )
        with self.assertRaisesRegex(ValueError, "duplicate"):
            read_manifest(duplicate.encode(), expected)

    def test_missing_image_wrong_python_and_architecture_are_rejected(self):
        with (
            patch.dict(os.environ, {"ImageVersion": ""}),
            self.assertRaisesRegex(ValueError, "image identity"),
        ):
            self.create()
        for name, value in (("machine", "x86_64"), ("python_version", "3.13.1")):
            with (
                patch(
                    f"scripts.build.runtime_artifact_policy.platform.{name}",
                    return_value=value,
                ),
                self.assertRaisesRegex(ValueError, "platform"),
            ):
                self.create()

    def test_symbolic_binary_and_existing_output_are_never_replaced(self):
        self.create()
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.create()
        target = self.root / TARGET
        target.unlink()
        target.symlink_to(self.output / SIDECAR)
        with self.assertRaisesRegex(ValueError, "artifact file"):
            create_artifact(self.root, self.root / ".build/other", self.source)
        self.assertEqual((self.output / SIDECAR).read_bytes(), self.binary)
