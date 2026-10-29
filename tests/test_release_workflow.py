"""Release scheduling and publication gates stay bound to one validated commit."""

from __future__ import annotations

import itertools
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).parents[1]
RUST_CACHE = "Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0"
SOURCE_SHA = "${{ needs.validate.outputs.sha }}"


def workflow(name: str) -> dict:
    # BaseLoader preserves Actions' `on` key instead of treating it as YAML 1.1 true.
    return yaml.load(
        (ROOT / ".github/workflows" / name).read_text(), Loader=yaml.BaseLoader
    )


def commands(job: dict) -> str:
    return "\n".join(step.get("run", "") for step in job["steps"])


def enabled(
    expression: str, results: dict[str, str], *, cancelled: bool = False
) -> bool:
    """Evaluate only the boolean status expressions used by these release gates."""
    value = re.sub(
        r"needs\.([a-z_]+)\.result", lambda match: repr(results[match[1]]), expression
    )
    value = value.replace("always()", "True").replace("cancelled()", str(cancelled))
    value = value.replace("&&", " and ").replace("||", " or ")
    value = re.sub(r"!(?!=)", "not ", value)
    return bool(eval(value, {"__builtins__": {}}, {}))


class ReleaseWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.release = workflow("release.yml")["jobs"]
        self.ci = workflow("ci.yml")["jobs"]

    def test_quality_rust_and_build_run_in_parallel_for_the_validated_sha(self) -> None:
        for name in ("quality", "rust", "build"):
            with self.subTest(job=name):
                job = self.release[name]
                self.assertEqual(job["needs"], "validate")
                self.assertEqual(job["runs-on"], "macos-15")
                checkout = next(
                    step
                    for step in job["steps"]
                    if step.get("uses", "").startswith("actions/checkout@")
                )
                self.assertEqual(checkout["with"]["ref"], SOURCE_SHA)
                self.assertTrue(
                    enabled(job["if"], {"validate": "success", "prepare": "skipped"})
                )
                for result in ("failure", "cancelled", "skipped"):
                    self.assertFalse(enabled(job["if"], {"validate": result}))
                self.assertFalse(
                    enabled(job["if"], {"validate": "success"}, cancelled=True)
                )

    def test_publish_requires_every_check_and_artifact_to_succeed(self) -> None:
        publish = self.release["publish"]
        required = ("validate", "quality", "rust", "build")
        self.assertEqual(set(publish["needs"]), set(required))
        for values in itertools.product(
            ("success", "failure", "cancelled", "skipped"), repeat=4
        ):
            results = dict(zip(required, values, strict=True))
            with self.subTest(results=results):
                self.assertEqual(
                    enabled(publish["if"], results),
                    all(value == "success" for value in values),
                )
        self.assertFalse(
            enabled(publish["if"], dict.fromkeys(required, "success"), cancelled=True)
        )

    def test_mac_quality_and_rust_coverage_is_preserved(self) -> None:
        quality = commands(self.release["quality"]).splitlines()
        for command in (
            "pnpm generate api",
            "git diff --exit-code -- packages/api-client/src/generated-schema.d.ts",
            "pnpm check",
            "pnpm test",
        ):
            self.assertIn(command, quality)
        rust = self.release["rust"]
        self.assertEqual(rust["env"]["CARGO_BUILD_JOBS"], "2")
        self.assertEqual(rust["env"]["CARGO_PROFILE_DEV_DEBUG"], "0")
        rust_commands = commands(rust)
        for command in ("cargo fmt --check", "cargo clippy", "cargo test"):
            self.assertIn(command, rust_commands)
        self.assertIn("-D warnings", rust_commands)
        for name in ("quality", "rust"):
            self.assertIn(
                "git diff --exit-code", commands(self.release[name]).splitlines()
            )
        self.assertIn(
            "touch apps/desktop/src-tauri/binaries/mlx-studio-runtime-aarch64-apple-darwin",
            rust_commands,
        )
        self.assertEqual(self.ci["rust"]["runs-on"], "macos-14")

    def test_rust_caches_preserve_configuration_hashes_and_separate_profiles(
        self,
    ) -> None:
        keys = []
        for job, expected in (
            (self.ci["rust"], "macos-14-check"),
            (self.release["rust"], "macos-15-check"),
            (self.release["build"], "macos-15-release"),
        ):
            cache = next(
                step for step in job["steps"] if step.get("uses") == RUST_CACHE
            )
            config = cache["with"]
            self.assertEqual(config["workspaces"], "apps/desktop/src-tauri -> target")
            self.assertEqual(config["shared-key"], expected)
            self.assertNotEqual(config.get("add-rust-environment-hash-key"), "false")
            keys.append(config["shared-key"])
        self.assertEqual(len(set(keys)), 3)

    def test_build_restores_or_builds_runtime_without_rebuilding_the_complete_app(
        self,
    ) -> None:
        build = self.release["build"]
        self.assertEqual(build["permissions"], {"contents": "read", "actions": "read"})
        steps = build["steps"]
        restore = next(step for step in steps if step.get("id") == "runtime")
        self.assertIn(
            'scripts.release.restore_runtime --repository "$GITHUB_REPOSITORY" --commit "$RELEASE_SHA"',
            restore["run"],
        )
        self.assertEqual(restore["env"]["GH_TOKEN"], "${{ github.token }}")
        self.assertNotIn("GH_TOKEN", build.get("env", {}))
        self.assertEqual(sum("GH_TOKEN" in step.get("env", {}) for step in steps), 1)
        fallback = next(
            step for step in steps if step.get("run") == "pnpm build runtime"
        )
        self.assertEqual(fallback["if"], "steps.runtime.outputs.restored != 'true'")
        coding = next(
            step for step in steps if step.get("run") == "pnpm build coding-bundle"
        )
        tauri = next(
            step for step in steps if "tauri build --ci" in step.get("run", "")
        )
        self.assertLess(steps.index(coding), steps.index(restore))
        self.assertLess(steps.index(restore), steps.index(fallback))
        self.assertLess(steps.index(fallback), steps.index(tauri))
        build_commands = commands(build)
        self.assertNotIn("pnpm build app", build_commands)
        self.assertNotIn("pnpm build web", build_commands)
        self.assertIn("pnpm build coding-bundle", build_commands)
        self.assertIn(
            "pnpm --filter @mlx-studio/desktop tauri build --ci", build_commands
        )
        self.assertIn("git diff --exit-code", build_commands)

    def test_final_dmg_and_installer_validation_remain_before_public_assets(
        self,
    ) -> None:
        steps = self.release["build"]["steps"]
        acceptance = next(
            index
            for index, step in enumerate(steps)
            if "hdiutil verify" in step.get("run", "")
        )
        installer = next(
            index
            for index, step in enumerate(steps)
            if "scripts.acceptance.verify_installer" in step.get("run", "")
        )
        upload = next(
            index
            for index, step in enumerate(steps)
            if step.get("with", {}).get("name")
            == "release-${{ needs.validate.outputs.tag }}"
        )
        self.assertLess(acceptance, installer)
        self.assertLess(installer, upload)
        self.assertIn(
            "--profile smoke --duration-seconds 0 --cycles 2", steps[acceptance]["run"]
        )
        self.assertIn("scripts.release.release collect", steps[acceptance]["run"])
        self.assertNotIn("if", steps[acceptance])
        self.assertNotIn("if", steps[installer])

    def test_reusable_runtime_is_uploaded_only_from_main_after_runtime_acceptance(
        self,
    ) -> None:
        steps = self.ci["runtime-bundle"]["steps"]
        checks = next(
            index
            for index, step in enumerate(steps)
            if "scripts.acceptance.verify_desktop_shutdown" in step.get("run", "")
        )
        provenance = next(
            index
            for index, step in enumerate(steps)
            if "scripts.build.runtime_artifact create" in step.get("run", "")
        )
        upload = next(
            index
            for index, step in enumerate(steps)
            if step.get("with", {}).get("name")
            == "runtime-release-${{ github.sha }}-${{ github.run_attempt }}"
        )
        self.assertLess(checks, provenance)
        self.assertLess(provenance, upload)
        self.assertIn(
            ".build/runtime/venv-release/bin/python", steps[provenance]["run"]
        )
        self.assertIn("scripts.build.runtime_artifact verify", steps[provenance]["run"])
        self.assertNotIn("if", steps[provenance])
        self.assertEqual(
            steps[upload]["if"],
            "github.event_name == 'push' && github.ref == 'refs/heads/main'",
        )
        self.assertEqual(steps[upload]["with"]["compression-level"], "0")
        self.assertEqual(steps[upload]["with"]["retention-days"], "7")
