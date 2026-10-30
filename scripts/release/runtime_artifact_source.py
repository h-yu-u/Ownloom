"""Bounded, read-only GitHub access and trusted CI artifact selection."""

from __future__ import annotations

import json
import os
import re
import selectors
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from scripts.build.runtime_artifact_policy import MAX_ARCHIVE, WORKFLOW, Provenance


class Unavailable(Exception):
    """A stable, non-secret reason to rebuild the Runtime from source."""


def read_command(args: list[str], output: Path, maximum: int, timeout: int) -> None:
    with subprocess.Popen(
        args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ) as child:
        try:
            assert child.stdout is not None
            deadline, written = time.monotonic() + timeout, 0
            with selectors.DefaultSelector() as selector, output.open("xb") as stream:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise Unavailable("GitHub read timed out")
                    if not selector.select(min(remaining, 1)):
                        continue
                    chunk = os.read(child.stdout.fileno(), 1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > maximum:
                        raise Unavailable("GitHub response exceeded its limit")
                    stream.write(chunk)
            result = child.wait(timeout=max(0.1, deadline - time.monotonic()))
            if result:
                raise Unavailable("GitHub API request failed")
        finally:
            if child.poll() is None:
                child.kill()
            child.wait()


class GitHub:
    def arguments(self, endpoint: str) -> list[str]:
        return [
            "gh",
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            "--header",
            "Accept: application/vnd.github+json",
            "--header",
            "X-GitHub-Api-Version: 2022-11-28",
            "--header",
            "Cache-Control: no-cache",
            endpoint,
        ]

    def json(self, endpoint: str) -> object:
        with tempfile.TemporaryDirectory(prefix="ownloom-runtime-api-") as temp:
            path = Path(temp) / "response.json"
            read_command(self.arguments(endpoint), path, 8 * 1024**2, 30)
            return json.loads(path.read_bytes())

    def download(
        self, repository: str, identifier: int, path: Path, maximum: int
    ) -> None:
        # Construct the API route; never follow URLs supplied in JSON metadata.
        endpoint = f"repos/{repository}/actions/artifacts/{identifier}/zip"
        read_command(self.arguments(endpoint), path, maximum, 180)


@dataclass(frozen=True)
class Candidate:
    source: Provenance
    workflow_id: int
    repository_id: int
    artifact_id: int
    archive_bytes: int
    archive_digest: str


def positive(value: object) -> bool:
    return type(value) is int and value > 0


def eligible_run(run: object, repository: str, commit: str, workflow_id: int) -> bool:
    if not isinstance(run, dict):
        return False
    repo, head = run.get("repository"), run.get("head_repository")
    return (
        isinstance(repo, dict)
        and isinstance(head, dict)
        and repo.get("full_name") == head.get("full_name") == repository
        and positive(repo.get("id"))
        and positive(head.get("id"))
        and repo.get("id") == head.get("id")
        and run.get("head_sha") == commit
        and run.get("head_branch") == "main"
        and run.get("event") == "push"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("workflow_id") == workflow_id
        and run.get("path")
        in {WORKFLOW, WORKFLOW + "@main", WORKFLOW + "@refs/heads/main"}
        and positive(run.get("id"))
        and positive(run.get("run_attempt"))
    )


def bounded_items(response: object, key: str, limit: int) -> list[object]:
    if not isinstance(response, dict):
        raise Unavailable("GitHub returned invalid metadata")
    items, total = response.get(key), response.get("total_count")
    if (
        not isinstance(items, list)
        or type(total) is not int
        or not len(items) == total <= limit
    ):
        raise Unavailable("GitHub metadata exceeded the inspection bound")
    return items


def select_candidate(client: GitHub, repository: str, commit: str) -> Candidate:
    prefix = f"repos/{repository}/actions"
    workflow = client.json(f"{prefix}/workflows/ci.yml")
    if (
        not isinstance(workflow, dict)
        or workflow.get("path") != WORKFLOW
        or not positive(workflow.get("id"))
    ):
        raise Unavailable("CI workflow identity differs")
    workflow_id = workflow["id"]
    response = client.json(
        f"{prefix}/workflows/{workflow_id}/runs?event=push&branch=main"
        f"&head_sha={commit}&status=completed&per_page=50"
    )
    eligible = [
        run
        for run in bounded_items(response, "workflow_runs", 50)
        if eligible_run(run, repository, commit, workflow_id)
    ]
    if not eligible:
        raise Unavailable("no completed successful main CI for this commit")
    run = max(eligible, key=lambda item: item["id"])
    source = Provenance(repository, commit, run["id"], run["run_attempt"])
    response = client.json(f"{prefix}/runs/{source.run_id}/artifacts?per_page=100")
    name = f"runtime-release-{commit}-{source.attempt}"
    artifacts = [
        item
        for item in bounded_items(response, "artifacts", 100)
        if isinstance(item, dict) and item.get("name") == name
    ]
    if len(artifacts) != 1:
        raise Unavailable("matching Runtime artifact is unavailable or ambiguous")
    return validate_artifact(artifacts[0], source, workflow_id, run["repository"]["id"])


def validate_artifact(
    artifact: dict[str, object],
    source: Provenance,
    workflow_id: int,
    repository_id: int,
) -> Candidate:
    run = artifact.get("workflow_run")
    digest, size = artifact.get("digest"), artifact.get("size_in_bytes")
    if (
        artifact.get("expired") is not False
        or not positive(artifact.get("id"))
        or not positive(size)
        or size > MAX_ARCHIVE
        or not isinstance(digest, str)
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)
        or not isinstance(run, dict)
        or any(
            not positive(run.get(key))
            for key in ("id", "repository_id", "head_repository_id")
        )
        or run.get("id") != source.run_id
        or run.get("repository_id") != repository_id
        or run.get("head_repository_id") != repository_id
        or run.get("head_branch") != "main"
        or run.get("head_sha") != source.commit
    ):
        raise Unavailable("artifact is expired or its source identity differs")
    return Candidate(
        source, workflow_id, repository_id, artifact["id"], size, digest[7:]
    )


def revalidate_run(client: GitHub, candidate: Candidate) -> None:
    source = candidate.source
    run = client.json(f"repos/{source.repository}/actions/runs/{source.run_id}")
    if (
        not eligible_run(run, source.repository, source.commit, candidate.workflow_id)
        or run["id"] != source.run_id
        or run["run_attempt"] != source.attempt
        or run["repository"]["id"] != candidate.repository_id
    ):
        raise Unavailable("CI run changed while restoring its artifact")
