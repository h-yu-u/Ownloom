"""Check archive accounting and the final-artifact dependency boundary."""

import unittest

from scripts.build.report_runtime_bundle import ArchiveEntry, summarize


class RuntimeBundleReportTests(unittest.TestCase):
    def test_source_and_bytecode_are_counted_once_with_all_overhead(self) -> None:
        report = summarize(
            [
                ArchiveEntry("torch/lib/libtorch.dylib", 400, "file"),
                ArchiveEntry("torch/__init__.py", 80, "file"),
                ArchiveEntry("torch", 100, "module"),
                ArchiveEntry("scipy.signal", 50, "module"),
                ArchiveEntry("PYZ.pyz", 10, "pyz-overhead"),
            ],
            sidecar_bytes=1000,
        )
        sizes = report["stored_bytes_by_package"]
        self.assertEqual(sizes["torch"], 580)
        self.assertEqual(sum(sizes.values()), 1000)
        self.assertEqual(sizes["<executable, archive index and signature>"], 360)
        self.assertEqual(report["boundary_status"], "passed")

    def test_rejects_test_data_and_bytecode_but_preserves_runtime_helpers(self) -> None:
        report = summarize(
            [
                ArchiveEntry("scipy/special/tests/data/boost.npz", 30, "file"),
                ArchiveEntry("numpy.linalg.tests.test_linalg", 20, "module"),
                ArchiveEntry("numpy.testing._private.utils", 20, "module"),
                ArchiveEntry("numpy/_core/_multiarray_tests.so", 20, "file"),
                ArchiveEntry("jinja2.tests", 10, "module"),
            ],
            sidecar_bytes=120,
        )
        self.assertEqual(report["boundary_status"], "failed")
        self.assertEqual(
            report["forbidden_test_entries"],
            ["numpy.linalg.tests.test_linalg", "scipy/special/tests/data/boost.npz"],
        )

    def test_invalid_sizes_cannot_be_reported_as_success(self) -> None:
        for length, total in ((-1, 10), (11, 10)):
            with self.subTest(length=length), self.assertRaises(ValueError):
                summarize([ArchiveEntry("runtime", length, "file")], total)


if __name__ == "__main__":
    unittest.main()
