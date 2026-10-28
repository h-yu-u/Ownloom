import json
import unittest

from scripts.verify.system_probe import parse_hardware_overview, parse_system_profiler


class ParseHardwareOverviewTests(unittest.TestCase):
    def test_extracts_only_chip_and_memory(self) -> None:
        raw = json.dumps(
            {
                "SPHardwareDataType": [
                    {
                        "chip_type": "Apple M5 Pro",
                        "physical_memory": "64 GB",
                        "serial_number": "must not be returned",
                    }
                ]
            }
        )

        chip, memory_bytes = parse_hardware_overview(raw)

        self.assertEqual(chip, "Apple M5 Pro")
        self.assertEqual(memory_bytes, 64 * 1024**3)

    def test_handles_missing_or_unexpected_memory_format(self) -> None:
        chip, memory_bytes = parse_hardware_overview(
            json.dumps({"SPHardwareDataType": [{"chip_type": "Apple M5 Pro"}]})
        )

        self.assertEqual(chip, "Apple M5 Pro")
        self.assertIsNone(memory_bytes)


class ParseSystemProfilerTests(unittest.TestCase):
    def test_reports_supported_metal_description(self) -> None:
        result = parse_system_profiler(
            json.dumps({"SPDisplaysDataType": [{"spdisplays_metal": "Metal 3"}]})
        )

        self.assertTrue(result["available"])
        self.assertEqual(result["description"], "Metal 3")

    def test_reports_unknown_when_metal_field_is_missing(self) -> None:
        result = parse_system_profiler(json.dumps({"SPDisplaysDataType": []}))

        self.assertIsNone(result["available"])
        self.assertIsNone(result["description"])

    def test_reports_unknown_for_unreadable_output(self) -> None:
        result = parse_system_profiler("not json")

        self.assertIsNone(result["available"])


if __name__ == "__main__":
    unittest.main()
