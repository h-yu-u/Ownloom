"""Synthetic source checkouts and inert Mach-O bytes; never a runnable Sidecar."""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from scripts.build.runtime_artifact import create_artifact
from scripts.build.runtime_artifact_policy import (
    REQUIRED,
    SIDECAR,
    TARGET,
    WORKFLOW,
    Provenance,
)


class ArtifactFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in (*REQUIRED, "services/runtime/src/entry.py", "README.md"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# isolated fixture\n")
        (self.root / "services/runtime/src/__init__.py").touch()
        (self.root / "services/runtime/pyproject.toml").write_text(
            '[project]\nname = "fixture"\n'
        )
        self.versions = {
            "pyinstaller": "6.16.0",
            "pyinstaller-hooks-contrib": "2026.10",
        }
        (self.root / "services/runtime/uv.lock").write_text(
            "".join(
                f'[[package]]\nname = "{name}"\nversion = "{version}"\n'
                for name, version in self.versions.items()
            )
        )
        (self.root / ".gitignore").write_text(
            ".build/\n__pycache__/\napps/desktop/src-tauri/binaries/\n"
        )
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Artifact fixture")
        self.git("config", "user.email", "fixture@example.org")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.commit = self.git("rev-parse", "HEAD")
        self.source = Provenance("example/ownloom", self.commit, 101, 2)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, result in (
            ("system", "Darwin"),
            ("machine", "arm64"),
            ("python_implementation", "CPython"),
            ("python_version", "3.12.12"),
        ):
            self.stack.enter_context(
                patch(
                    f"scripts.build.runtime_artifact_policy.platform.{name}",
                    return_value=result,
                )
            )
        self.stack.enter_context(
            patch(
                "scripts.build.runtime_artifact_policy.importlib.metadata.version",
                side_effect=self.versions.__getitem__,
            )
        )
        self.stack.enter_context(
            patch.dict(
                os.environ,
                {
                    "ImageOS": "macos15-arm64",
                    "ImageVersion": "20261020.1",
                    "GITHUB_REPOSITORY": self.source.repository,
                    "GITHUB_RUN_ID": "101",
                    "GITHUB_RUN_ATTEMPT": "2",
                    "GITHUB_SHA": self.commit,
                },
            )
        )
        self.binary = (
            b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01" + b"not executable; artifact fixture"
        )
        target = self.root / TARGET
        target.parent.mkdir(parents=True)
        target.write_bytes(self.binary)
        target.chmod(0o755)
        report = self.root / ".build/runtime/archive-size.json"
        report.parent.mkdir(parents=True)
        report.write_text(
            json.dumps(
                {
                    "profile": "release",
                    "boundary_status": "passed",
                    "sidecar": {
                        "name": SIDECAR,
                        "bytes": len(self.binary),
                        "sha256": hashlib.sha256(self.binary).hexdigest(),
                    },
                }
            )
        )
        self.output = self.root / ".build/reusable"

    def git(self, *args):
        return subprocess.check_output(
            [
                "git",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
                "-C",
                str(self.root),
                *args,
            ],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()

    def create(self):
        create_artifact(self.root, self.output, self.source)
        return json.loads((self.output / "manifest.json").read_text())


class FakeGitHub:
    def __init__(self, fixture: ArtifactFixture):
        self.fixture = fixture
        self.calls = []
        self.downloaded = []
        self.error = None
        self.after_download = None
        self.run = {
            "id": 101,
            "run_attempt": 2,
            "workflow_id": 17,
            "path": WORKFLOW,
            "repository": {"id": 7, "full_name": fixture.source.repository},
            "head_repository": {"id": 7, "full_name": fixture.source.repository},
            "head_sha": fixture.commit,
            "head_branch": "main",
            "event": "push",
            "status": "completed",
            "conclusion": "success",
        }
        self.artifact = {
            "id": 30,
            "name": f"runtime-release-{fixture.commit}-2",
            "expired": False,
            "workflow_run": {
                "id": 101,
                "repository_id": 7,
                "head_repository_id": 7,
                "head_sha": fixture.commit,
                "head_branch": "main",
            },
            "archive_download_url": "https://invalid.example/never-request-this",
        }
        self.workflow = {"id": 17, "path": WORKFLOW}
        self.archive = fixture.root / ".build/runtime.zip"
        self.repack()

    def repack(self):
        with zipfile.ZipFile(
            self.archive, "w", compression=zipfile.ZIP_STORED
        ) as archive:
            for path in self.fixture.output.iterdir():
                archive.write(path, path.name)
        self.update_digest()

    def update_digest(self):
        data = self.archive.read_bytes()
        self.artifact.update(
            size_in_bytes=len(data), digest="sha256:" + hashlib.sha256(data).hexdigest()
        )

    def json(self, endpoint):
        self.calls.append(endpoint)
        if self.error:
            raise self.error
        if endpoint.endswith("/workflows/ci.yml"):
            return self.workflow
        if "/workflows/17/runs?" in endpoint:
            return {"total_count": 1, "workflow_runs": [self.run]}
        if endpoint.endswith("/runs/101/artifacts?per_page=100"):
            return {"total_count": 1, "artifacts": [self.artifact]}
        if endpoint.endswith("/runs/101"):
            return self.run
        raise AssertionError(endpoint)

    def download(self, repository, identifier, path, maximum):
        self.downloaded.append(path)
        assert repository == self.fixture.source.repository
        assert identifier == 30
        shutil.copyfile(self.archive, path)
        if self.after_download:
            self.after_download()
