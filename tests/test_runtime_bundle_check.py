import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from importlib.metadata import PackageNotFoundError
from pathlib import Path
from unittest.mock import patch

from docx.opc.exceptions import PackageNotFoundError as DocxPackageNotFoundError
from mlx_studio_runtime.adapters.worker_runtime import bundle_check

SOURCE = Path(__file__).resolve().parents[1] / "services/runtime/src"


class RuntimeBundleEntryPointTests(unittest.TestCase):
    def invoke_check(self, body: str, *, frozen: bool = True):
        with tempfile.TemporaryDirectory(prefix="ownloom-bundle-check-") as directory:
            data = Path(directory) / "product-data"
            script = (
                "import os, sys\n"
                "from types import ModuleType\n"
                "from mlx_studio_runtime.adapters.worker_runtime import bundle_check\n"
                "from mlx_studio_runtime.entrypoints.http.main import main\n"
                "core = ModuleType('mlx.core')\n"
                "core.cpu, core.selected_device = 'cpu', 'gpu'\n"
                "core.set_default_device = lambda device: "
                "setattr(core, 'selected_device', device)\n"
                "sys.modules['mlx.core'] = core\n"
                f"sys.frozen = {frozen!r}\n"
                f"sys._MEIPASS = {directory!r}\n"
                "sys.argv = ['sidecar', '--check-bundle']\n"
                "def fixture_check():\n"
                + textwrap.indent(textwrap.dedent(body), "    ")
                + "\nbundle_check.CHECKS = "
                "(bundle_check.CHECKS[0], ('fixture', fixture_check))\n"
                "raise SystemExit(main())\n"
            )
            result = subprocess.run(
                [sys.executable, "-c", script],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
                cwd=directory,
                env={
                    **os.environ,
                    "PYTHONPATH": str(SOURCE),
                    "MLX_STUDIO_DATA_DIR": str(data),
                    "HF_HUB_OFFLINE": "0",
                    "TRANSFORMERS_OFFLINE": "0",
                },
            )
            self.assertFalse(
                data.exists(), "Bundle checks must not start product storage"
            )
            return result

    def test_entrypoint_returns_one_json_report_and_redirects_import_noise(self):
        result = self.invoke_check(
            """
            print('upstream Python output')
            os.write(1, b'upstream native output\\n')
            import ctypes
            ctypes.CDLL(None).printf(b'upstream buffered native output\\n')
            return {
                'hubOffline': os.environ['HF_HUB_OFFLINE'],
                'transformersOffline': os.environ['TRANSFORMERS_OFFLINE'],
            }
            """
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(result.stdout.splitlines()), 1)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "passed")
        self.assertTrue(report["frozen"])
        self.assertEqual(report["scope"], "imports-and-resources")
        self.assertEqual(report["device"], "cpu")
        self.assertEqual(
            report["checks"]["fixture"]["details"],
            {"hubOffline": "1", "transformersOffline": "1"},
        )
        self.assertIn("upstream Python output", result.stderr)
        self.assertIn("upstream native output", result.stderr)
        self.assertIn("upstream buffered native output", result.stderr)
        self.assertIn("model loading and inference", report["unverified"])
        self.assertIn("Metal GPU execution", report["unverified"])

    def test_entrypoint_selects_cpu_before_engine_imports(self):
        result = self.invoke_check(
            """
            if core.selected_device != 'cpu':
                raise RuntimeError('Engine import would initialize Metal')
            return {'device': core.selected_device}
            """
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["checks"]["mlxDevice"]["status"], "passed")
        self.assertEqual(report["checks"]["fixture"]["details"], {"device": "cpu"})

    def test_missing_dependency_fails_without_starting_the_server(self):
        result = self.invoke_check(
            """
            try:
                return bundle_check.check_imports(('ownloom_missing_bundle_fixture',))
            except ModuleNotFoundError as error:
                raise ModuleNotFoundError('Could not import module fixture') from error
            """
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(len(result.stdout.splitlines()), 1)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["checks"]["fixture"]["status"], "failed")
        self.assertIn("ModuleNotFoundError", report["checks"]["fixture"]["error"])
        self.assertIn("Traceback (most recent call last):", result.stderr)
        self.assertIn("ownloom_missing_bundle_fixture", result.stderr)
        self.assertIn("Could not import module fixture", result.stderr)

    def test_source_python_cannot_pass_as_a_packaged_sidecar(self):
        result = self.invoke_check(
            "raise AssertionError('must not execute')", frozen=False
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertFalse(report["frozen"])
        self.assertEqual(report["checks"]["environment"]["status"], "failed")
        self.assertNotIn("fixture", report["checks"])


class RuntimeBundleResourceTests(unittest.TestCase):
    def test_document_resources_support_in_memory_roundtrips(self):
        result = bundle_check.check_documents()
        self.assertGreater(result["docxBytes"], 0)
        self.assertGreater(result["pdfBytes"], 0)

    def test_missing_docx_template_is_not_treated_as_a_success(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch(
                "docx.api._default_docx_path",
                return_value=str(Path(directory) / "missing-default.docx"),
            ),
            self.assertRaises(DocxPackageNotFoundError),
        ):
            bundle_check.check_documents()

    def test_image_resources_support_in_memory_encoding_and_decoding(self):
        result = bundle_check.check_images()
        for format_name in ("PNG", "JPEG", "GIF", "WEBP"):
            with self.subTest(format=format_name):
                self.assertGreater(result[format_name], 0)

    def test_missing_distribution_metadata_is_a_failure(self):
        with (
            patch(
                "mlx_studio_runtime.adapters.worker_runtime.bundle_check.version",
                side_effect=PackageNotFoundError("pillow"),
            ),
            self.assertRaises(PackageNotFoundError),
        ):
            bundle_check.check_metadata()
