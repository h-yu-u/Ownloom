"""Packaging boundaries exercised with installed-distribution and archive fixtures."""

import csv
import tempfile
import unittest
from importlib.metadata import Distribution
from pathlib import Path

from scripts.build.runtime_bundle import (
    distribution_modules,
    is_numerical_test,
    runtime_entries,
)


def installed_fixture(root: Path, files: dict[str, str]) -> Distribution:
    metadata = root / "fixture-1.0.dist-info"
    metadata.mkdir()
    (metadata / "METADATA").write_text("Name: fixture\nVersion: 1.0\n")
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    with (metadata / "RECORD").open("w", newline="") as stream:
        csv.writer(stream).writerows((name, "", "") for name in files)
    return Distribution.at(metadata)


class RuntimeBundleTests(unittest.TestCase):
    def test_registry_discovers_every_model_without_importing_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            installed = installed_fixture(
                Path(directory),
                {
                    "engine/models/__init__.py": "raise RuntimeError('must not import')",
                    "engine/models/current/__init__.py": "raise RuntimeError()",
                    "engine/models/current/processor.py": "raise RuntimeError()",
                    "engine/models/new_family/model.py": "raise RuntimeError()",
                    "engine/models/model-with-hyphens.py": "raise RuntimeError()",
                    "engine/models_extra/unsupported.py": "",
                    "engine/models/current/processor.pyi": "",
                },
            )
            modules = distribution_modules(installed, ("engine.models",))
        self.assertIn("engine.models.current.processor", modules)
        self.assertIn("engine.models.new_family.model", modules)
        self.assertIn("engine.models.model-with-hyphens", modules)
        self.assertNotIn("engine.models_extra.unsupported", modules)
        self.assertEqual(len(modules), len(set(modules)))

    def test_namespace_registry_without_init_keeps_its_plugin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            installed = installed_fixture(
                Path(directory),
                {"tiktoken_ext/openai_public.py": "raise RuntimeError()"},
            )
            modules = distribution_modules(installed, ("tiktoken_ext",))
        self.assertEqual(modules, ["tiktoken_ext", "tiktoken_ext.openai_public"])

    def test_missing_registry_or_manifest_is_not_silently_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            installed = installed_fixture(Path(directory), {"engine/__init__.py": ""})
            with self.assertRaisesRegex(ValueError, "registry is missing"):
                distribution_modules(installed, ("engine.models",))
            (Path(directory) / "fixture-1.0.dist-info/RECORD").unlink()
            with self.assertRaisesRegex(ValueError, "no file manifest"):
                distribution_modules(installed, ("engine",))

    def test_test_filter_is_scoped_to_exact_numerical_test_trees(self) -> None:
        for name in (
            "numpy._core.tests.test_numeric",
            "scipy.special.tests",
            "numpy/_core/tests/data/array.npy",
            "scipy/special/tests/data/boost.npz",
            "scipy\\special\\tests\\helper.so",
        ):
            with self.subTest(name=name):
                self.assertTrue(is_numerical_test(name))
        for name in (
            "numpy.testing",
            "numpy/testing/_private/utils.py",
            "numpy/_core/_multiarray_tests.cpython-312-darwin.so",
            "scipy._lib._testutils",
            "scipy/special/tests_extra/resource.txt",
            "torch.testing._internal.common_utils",
            "jinja2.tests",
            "jinja2/tests.py",
        ):
            with self.subTest(name=name):
                self.assertFalse(is_numerical_test(name))

    def test_filtered_fixture_stages_required_sources_and_resources(self) -> None:
        preserved = {
            "mlx/lib/libmlx.dylib": "native",
            "mlx/lib/mlx.metallib": "metal",
            "mlx/include/mlx/backend/metal/kernels/steel/gemm/gemm.h": "header",
            "mflux/models/seedvr2/embeddings/pos_emb.safetensors": "resource",
            "docx/templates/default.docx": "template",
            "lxml/isoschematron/resources/iso-schematron-xslt1/iso_svrl_for_xslt1.xsl": "xsl",
            "transformers/models/example/modeling_example.py": "source",
            "torch/nn/modules/module.py": "source",
            "cv2/config-3.py": "source",
            "numpy/_core/_multiarray_tests.so": "extension",
            "certifi/cacert.pem": "certificate",
            "mlx_audio-0.5.9.dist-info/METADATA": "metadata",
            "numpy-2.5.3.dist-info/licenses/LICENSE.txt": "license",
        }
        removed = {
            "numpy/_core/tests/data/array.npy": "test array",
            "scipy/special/tests/data/boost.npz": "test reference",
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = []
            for name, content in (preserved | removed).items():
                source = root / "source" / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text(content)
                entries.append((name, str(source), "DATA"))
            for name, source, _kind in runtime_entries(entries):
                target = root / "staged" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(Path(source).read_bytes())
            for name, content in preserved.items():
                self.assertEqual((root / "staged" / name).read_text(), content)
            for name in removed:
                self.assertFalse((root / "staged" / name).exists())


if __name__ == "__main__":
    unittest.main()
