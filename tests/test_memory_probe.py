import unittest
from unittest.mock import patch

from mlx_studio_runtime.adapters.memory_probe import (
    linux_system_memory,
    mac_used_bytes,
    memory_totals,
    read_memory,
)


class MemoryProbeTests(unittest.TestCase):
    def test_mac_counts_resident_app_wired_and_actual_compressor_storage(self) -> None:
        self.assertEqual(mac_used_bytes(16384, 100, 10, 20, 5), 115 * 16384)
        self.assertEqual(mac_used_bytes(4096, 1, 10, 2, 3), 5 * 4096)

    def test_totals_are_consistent_at_sampling_boundaries(self) -> None:
        self.assertEqual(
            memory_totals(1000, 400),
            {
                "system_memory_total_bytes": 1000,
                "system_memory_used_bytes": 400,
                "system_memory_available_bytes": 600,
                "system_memory_used_percent": 40.0,
            },
        )
        self.assertEqual(memory_totals(1000, 1001)["system_memory_used_percent"], 100)
        with self.assertRaises(ValueError):
            memory_totals(0, 0)

    def test_linux_uses_available_memory_instead_of_free_pages(self) -> None:
        result = linux_system_memory(
            "MemTotal: 1000 kB\nMemFree: 10 kB\nMemAvailable: 400 kB\n"
        )
        self.assertEqual(result["system_memory_used_bytes"], 600 * 1024)

    def test_unavailable_os_counters_are_null_and_absent_worker_is_zero(self) -> None:
        with (
            patch(
                "mlx_studio_runtime.adapters.memory_probe.platform.system",
                return_value="Darwin",
            ),
            patch(
                "mlx_studio_runtime.adapters.memory_probe.mac_memory",
                side_effect=OSError("unavailable"),
            ),
        ):
            result = read_memory(None)
            self.assertIsNone(result["system_memory_used_bytes"])
            self.assertEqual(result["worker_memory_bytes"], 0)
            self.assertIsNone(read_memory(123)["worker_memory_bytes"])
