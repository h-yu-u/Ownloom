"""Restore only an exact-commit, verified Runtime artifact; otherwise build locally."""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import tempfile
from dataclasses import dataclass
from pathlib import Path

from scripts.build.runtime_artifact import extract_archive
from scripts.build.runtime_artifact_policy import (
    MAX_ARCHIVE,
    SIDECAR,
    TARGET,
    ArtifactError,
    environment,
    expected_manifest,
    file_digest,
    input_digest,
    validate_identity,
)
from scripts.release.runtime_artifact_source import (
    GitHub,
    Unavailable,
    revalidate_run,
    select_candidate,
)


@dataclass(frozen=True)
class RestoreResult:
    restored: bool
    reason: str


def install_verified(root: Path, source: Path) -> None:
    target = root / TARGET
    for parent in (target, *target.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise ArtifactError("installation path contains a symbolic link")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=".runtime-restore-", dir=target.parent, delete=False
        ) as stream:
            temporary = Path(stream.name)
            with source.open("rb") as candidate:
                shutil.copyfileobj(candidate, stream)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o755)
        if file_digest(temporary) != file_digest(source):
            raise ArtifactError("installed copy differs")
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def restore_runtime(
    root: Path, repository: str, commit: str, client: GitHub | None = None
) -> RestoreResult:
    try:
        validate_identity(repository, commit)
        input_digest(root, commit)
        environment(root)
        github = client or GitHub()
        candidate = select_candidate(github, repository, commit)
        expected = expected_manifest(root, candidate.source)
        with tempfile.TemporaryDirectory(prefix="ownloom-runtime-restore-") as temp:
            archive, staging = Path(temp) / "runtime.zip", Path(temp) / "payload"
            github.download(
                repository, candidate.artifact_id, archive, candidate.archive_bytes
            )
            if file_digest(archive, MAX_ARCHIVE) != (
                candidate.archive_bytes,
                candidate.archive_digest,
            ):
                raise ArtifactError("archive digest or size differs")
            staging.mkdir()
            extract_archive(archive, staging, expected)
            revalidate_run(github, candidate)
            if expected_manifest(root, candidate.source) != expected:
                raise ArtifactError("local build inputs changed during restore")
            install_verified(root, staging / SIDECAR)
        return RestoreResult(
            True,
            f"verified CI run {candidate.source.run_id}, attempt {candidate.source.attempt}",
        )
    except (Unavailable, ArtifactError) as error:
        return RestoreResult(False, str(error))
    except Exception as error:
        # API bodies, signed download URLs and subprocess output are never logged.
        return RestoreResult(
            False, f"artifact validation unavailable ({type(error).__name__})"
        )


def terminate(signum: int, _frame: object) -> None:
    raise SystemExit(128 + signum)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, terminate)
    result = restore_runtime(Path.cwd(), args.repository, args.commit)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a") as stream:
            stream.write(f"restored={str(result.restored).lower()}\n")
    status = "restored" if result.restored else "fallback to source build"
    print(f"Runtime artifact: {status}; {result.reason}")


if __name__ == "__main__":
    main()
