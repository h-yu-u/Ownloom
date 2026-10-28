from __future__ import annotations

import hashlib
import json
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.acceptance.installer_fixture import BASE, InstallerFixture

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/release/install.sh"
DMG = "ownloom-darwin-arm64.dmg"
TAG = "v0.1.1"


class InstallerTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="ownloom-installer-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.assets = self.root / "assets"
        self.assets.mkdir()
        (self.assets / DMG).write_bytes(b"synthetic disk image fixture")
        self.metadata: dict[str, object] = {
            "tag": TAG,
            "version": "0.1.1",
            "platform": "macOS",
            "architecture": "aarch64",
            "signing": "ad-hoc",
            "notarized": False,
            "dmgSha256": self.digest(self.assets / DMG),
        }
        self.app = self.root / "source/Ownloom.app"
        (self.app / "Contents/MacOS").mkdir(parents=True)
        self.info = {
            "CFBundleIdentifier": "local.mlxstudio.app",
            "CFBundleExecutable": "ownloom",
            "CFBundleShortVersionString": "0.1.1",
        }
        self.write_info()
        executable = self.app / "Contents/MacOS/ownloom"
        executable.write_text("synthetic executable; never launched\n")
        executable.chmod(0o755)
        self.destination = self.root / "Applications with spaces"
        self.destination.mkdir()
        self.fixture = InstallerFixture(self.root / "fixture", self.assets, self.app)
        self.refresh_assets()

    @staticmethod
    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def write_info(self) -> None:
        (self.app / "Contents/Info.plist").write_bytes(plistlib.dumps(self.info))

    def refresh_assets(self) -> None:
        (self.assets / "release-metadata.json").write_text(json.dumps(self.metadata))
        # The installer is piped to sh, so it is not a local checksum input.
        (self.assets / "install.sh").write_text("#!/bin/sh\nexit 0\n")
        (self.assets / "SHA256SUMS").write_text(
            "".join(
                f"{self.digest(self.assets / name)}  {name}\n"
                for name in (DMG, "release-metadata.json", "install.sh")
            )
        )

    def install(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "/bin/sh",
                str(SCRIPT),
                "--install-dir",
                str(self.destination),
                *arguments,
            ],
            env=self.fixture.environment,
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )

    def old_app(self) -> Path:
        app = self.destination / "Ownloom.app"
        shutil.copytree(self.app, app)
        (app / "old-only.txt").write_text("previous version")
        return app

    def assert_clean(self) -> None:
        self.assertFalse((self.fixture.root / "mounted").exists())
        self.assertEqual(list((self.fixture.root / "temporary").iterdir()), [])
        self.assertFalse(
            any(path.name.startswith(".") for path in self.destination.iterdir())
        )

    def test_first_install_is_pinned_and_uses_https_without_external_dependencies(
        self,
    ) -> None:
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            (self.destination / "Ownloom.app/Contents/Info.plist").read_bytes(),
            (self.app / "Contents/Info.plist").read_bytes(),
        )
        calls = self.fixture.calls()
        downloads = [call for call in calls if call[0] == "curl"]
        self.assertEqual(
            downloads[0][-1], f"{BASE}latest/download/release-metadata.json"
        )
        self.assertTrue(
            all(call[-1].startswith(f"{BASE}download/{TAG}/") for call in downloads[1:])
        )
        self.assertTrue(
            all("=https" in call and "--proto-redir" in call for call in downloads)
        )
        self.assertTrue(any(call[0] == "codesign" for call in calls))
        self.assert_clean()

    def test_explicit_version_and_rosetta_hardware_are_supported(self) -> None:
        self.fixture.update(machine="x86_64", arm_hardware="1")
        result = self.install("--version", TAG)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(
            any("latest/download" in call[-1] for call in self.fixture.calls())
        )
        self.assert_clean()

    def test_replacement_removes_old_files_and_leaves_user_data_untouched(self) -> None:
        installed = self.old_app()
        data = self.fixture.root / "home/model-and-user-data.txt"
        data.write_text("keep this user data")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((installed / "old-only.txt").exists())
        self.assertEqual(data.read_text(), "keep this user data")
        repeated = self.install()
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assert_clean()

    def test_failed_replacement_restores_the_previous_app(self) -> None:
        installed = self.old_app()
        self.fixture.update(fail_install_move=str(installed))
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((installed / "old-only.txt").read_text(), "previous version")
        self.assert_clean()

    def test_changed_download_is_rejected_before_app_replacement(self) -> None:
        installed = self.old_app()
        (self.assets / DMG).write_bytes(b"changed bytes")
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((installed / "old-only.txt").is_file())
        self.assertFalse(any(call[0] == "hdiutil" for call in self.fixture.calls()))
        self.assert_clean()

    def test_missing_or_duplicate_checksum_targets_are_rejected(self) -> None:
        path = self.assets / "SHA256SUMS"
        valid = path.read_text()
        for contents in (
            valid.replace(DMG, "other.dmg"),
            valid + valid.splitlines()[0] + "\n",
        ):
            with self.subTest(contents=contents):
                path.write_text(contents)
                self.assertNotEqual(self.install().returncode, 0)
                self.assertFalse((self.destination / "Ownloom.app").exists())
                self.assert_clean()

    def test_metadata_contract_mismatches_stop_installation(self) -> None:
        original = dict(self.metadata)
        for key, value in (
            ("tag", "v0.1.2"),
            ("version", "0.1.2"),
            ("platform", "Linux"),
            ("architecture", "x86_64"),
            ("dmgSha256", "0" * 64),
            ("tag", "../../escape"),
        ):
            with self.subTest(key=key):
                self.metadata = original | {key: value}
                self.refresh_assets()
                self.assertNotEqual(self.install("--version", TAG).returncode, 0)
                self.assertFalse((self.destination / "Ownloom.app").exists())
                self.assert_clean()

    def test_network_mount_copy_and_signature_failures_preserve_old_app(self) -> None:
        installed = self.old_app()
        for option in (
            "download_failure",
            "attach_failure",
            "copy_failure",
            "codesign_failure",
            "binary_failure",
        ):
            with self.subTest(option=option):
                self.fixture.update(
                    **{option: "all" if option == "download_failure" else True}
                )
                self.assertNotEqual(self.install().returncode, 0)
                self.assertTrue((installed / "old-only.txt").exists())
                self.assert_clean()
                self.fixture.update(**{option: False})

    def test_wrong_app_identity_or_version_is_rejected(self) -> None:
        original = dict(self.info)
        for key, value in (
            ("CFBundleIdentifier", "other.app"),
            ("CFBundleShortVersionString", "0.1.0"),
            ("CFBundleExecutable", "other"),
        ):
            with self.subTest(key=key):
                self.info = original | {key: value}
                self.write_info()
                self.assertNotEqual(self.install().returncode, 0)
                self.assertFalse((self.destination / "Ownloom.app").exists())
                self.assert_clean()

    def test_symlink_install_targets_are_rejected_without_touching_destination(
        self,
    ) -> None:
        actual = self.destination
        self.destination = self.root / "Applications link"
        self.destination.symlink_to(actual, target_is_directory=True)
        self.assertNotEqual(self.install().returncode, 0)
        self.assertEqual(list(actual.iterdir()), [])
        self.assertTrue(self.destination.is_symlink())

    def test_symlink_existing_app_is_rejected(self) -> None:
        (self.destination / "Ownloom.app").symlink_to(
            self.app, target_is_directory=True
        )
        self.assertNotEqual(self.install().returncode, 0)
        self.assertTrue((self.destination / "Ownloom.app").is_symlink())
        self.assertTrue(self.app.is_dir())
        self.assert_clean()

    def test_running_app_and_unknown_process_status_stop_replacement(self) -> None:
        installed = self.old_app()
        for status in (0, 2):
            with self.subTest(status=status):
                self.fixture.update(pgrep_status=status)
                self.assertNotEqual(self.install().returncode, 0)
                self.assertTrue((installed / "old-only.txt").exists())
                self.assert_clean()

    def test_unsupported_platform_and_intel_do_not_download(self) -> None:
        for changed in (
            {"system": "Linux"},
            {"system": "Darwin", "machine": "x86_64", "arm_hardware": "0"},
        ):
            with self.subTest(changed=changed):
                self.fixture.update(**changed)
                self.assertNotEqual(self.install().returncode, 0)
                self.assertFalse(
                    any(call[0] == "curl" for call in self.fixture.calls())
                )
                self.assert_clean()

    def test_help_and_invalid_arguments_do_not_download_or_install(self) -> None:
        self.assertEqual(self.install("--help").returncode, 0)
        for arguments in (
            ("--unknown",),
            ("--version", "main"),
            ("--version", "v01.2.3"),
            ("--version", "v1.2.3;echo"),
            ("--version",),
        ):
            with self.subTest(arguments=arguments):
                self.assertNotEqual(self.install(*arguments).returncode, 0)
        self.assertFalse(any(call[0] == "curl" for call in self.fixture.calls()))
        self.assertEqual(list(self.destination.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
