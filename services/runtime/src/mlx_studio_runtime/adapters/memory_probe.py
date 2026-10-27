"""Live OS memory counters; no model imports, external commands or extra dependencies."""

import ctypes
import platform
from functools import lru_cache
from pathlib import Path


class VMStatistics64(ctypes.Structure):
    internal: int
    purgeable: int
    wired: int
    compressor: int
    # Stable HOST_VM_INFO64 rev1 prefix, as declared in mach/vm_statistics.h.
    _fields_ = (
        [(name, ctypes.c_uint32) for name in ("free", "active", "inactive", "wired")]
        + [
            (name, ctypes.c_uint64)
            for name in (
                "zero_fill",
                "reactivations",
                "pageins",
                "pageouts",
                "faults",
                "cow_faults",
                "lookups",
                "hits",
                "purges",
            )
        ]
        + [(name, ctypes.c_uint32) for name in ("purgeable", "speculative")]
        + [
            (name, ctypes.c_uint64)
            for name in (
                "decompressions",
                "compressions",
                "swapins",
                "swapouts",
            )
        ]
        + [
            (name, ctypes.c_uint32)
            for name in (
                "compressor",
                "throttled",
                "external",
                "internal",
            )
        ]
        + [("uncompressed", ctypes.c_uint64)]
    )


class ProcessUsage(ctypes.Structure):
    footprint: int
    # RUSAGE_INFO_V0, including physical footprint (charged physical + compressed memory).
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64)
        for name in (
            "user_time",
            "system_time",
            "idle_wakeups",
            "interrupt_wakeups",
            "pageins",
            "wired",
            "resident",
            "footprint",
            "start_time",
            "exit_time",
        )
    ]


def memory_totals(total: int, used: int) -> dict[str, int | float]:
    if total <= 0:
        raise ValueError("Physical memory total must be positive")
    used = max(0, min(total, used))
    return {
        "system_memory_total_bytes": total,
        "system_memory_used_bytes": used,
        "system_memory_available_bytes": total - used,
        "system_memory_used_percent": round(used / total * 100, 1),
    }


def mac_used_bytes(
    page_size: int, internal: int, purgeable: int, wired: int, compressor: int
) -> int:
    # Excludes reclaimable file cache; counts actual compressor storage, not its logical size.
    return (max(0, internal - purgeable) + wired + compressor) * page_size


class MacMemory:
    def __init__(self) -> None:
        self.system = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        self.process = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.system.mach_host_self.restype = ctypes.c_uint32
        self.system.host_statistics64.argtypes = [
            ctypes.c_uint32,
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint32),
        ]
        self.system.sysctlbyname.argtypes = [
            ctypes.c_char_p,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_size_t),
            ctypes.c_void_p,
            ctypes.c_size_t,
        ]
        self.system.mach_port_deallocate.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
        self.system.host_page_size.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32)]
        self.process.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]

    def system_memory(self) -> dict[str, int | float]:
        total = ctypes.c_uint64()
        size = ctypes.c_size_t(ctypes.sizeof(total))
        if self.system.sysctlbyname(
            b"hw.memsize", ctypes.byref(total), ctypes.byref(size), None, 0
        ):
            raise OSError(ctypes.get_errno(), "Physical memory unavailable")
        stats = VMStatistics64()
        count = ctypes.c_uint32(ctypes.sizeof(stats) // ctypes.sizeof(ctypes.c_int))
        host = self.system.mach_host_self()
        page_size = ctypes.c_uint32()
        try:
            if self.system.host_statistics64(host, 4, ctypes.byref(stats), ctypes.byref(count)):
                raise OSError("VM statistics unavailable")
            if self.system.host_page_size(host, ctypes.byref(page_size)):
                raise OSError("VM page size unavailable")
        finally:
            task = ctypes.c_uint32.in_dll(self.system, "mach_task_self_").value
            self.system.mach_port_deallocate(task, host)
        return memory_totals(
            total.value,
            mac_used_bytes(
                page_size.value, stats.internal, stats.purgeable, stats.wired, stats.compressor
            ),
        )

    def process_memory(self, pid: int) -> int:
        usage = ProcessUsage()
        if self.process.proc_pid_rusage(pid, 0, ctypes.byref(usage)):
            raise OSError(ctypes.get_errno(), "Process memory unavailable")
        return int(usage.footprint)


def linux_system_memory(source: str) -> dict[str, int | float]:
    values = {
        line.split(":", 1)[0]: int(line.split()[1]) * 1024
        for line in source.splitlines()
        if ":" in line
    }
    total, available = values["MemTotal"], values["MemAvailable"]
    return memory_totals(total, total - available)


@lru_cache(maxsize=1)
def mac_memory() -> MacMemory:
    return MacMemory()


def read_memory(worker_pid: int | None) -> dict[str, int | float | None]:
    values: dict[str, int | float | None] = dict.fromkeys(
        (
            "system_memory_total_bytes",
            "system_memory_used_bytes",
            "system_memory_available_bytes",
            "system_memory_used_percent",
            "worker_memory_bytes",
        )
    )
    system = platform.system()
    try:
        if system == "Darwin":
            values.update(mac_memory().system_memory())
        elif system == "Linux":
            values.update(linux_system_memory(Path("/proc/meminfo").read_text()))
    except (OSError, ValueError, KeyError):
        pass  # Unavailable counters are explicitly null, never plausible zero usage.
    if worker_pid is None:
        values["worker_memory_bytes"] = 0
    else:
        try:
            if system == "Darwin":
                values["worker_memory_bytes"] = mac_memory().process_memory(worker_pid)
            elif system == "Linux":
                status = Path(f"/proc/{worker_pid}/status").read_text()
                for line in status.splitlines():
                    if line.startswith("VmRSS:"):
                        values["worker_memory_bytes"] = int(line.split()[1]) * 1024
        except (OSError, ValueError):
            pass  # A Worker may exit between obtaining its PID and reading OS counters.
    return values
