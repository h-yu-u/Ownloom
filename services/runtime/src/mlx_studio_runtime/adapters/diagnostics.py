"""Read-only host metrics and in-memory diagnostic archive generation."""

import io
import json
import os
import platform
import resource
import shutil
import time
import zipfile
from collections.abc import Callable
from pathlib import Path

from mlx_studio_runtime.adapters.memory_probe import read_memory


class HostDiagnostics:
    def __init__(self, data_directory: Path, worker_pid: Callable[[], int | None]) -> None:
        self.data_directory = data_directory
        self.worker_pid = worker_pid
        self.started_at = time.monotonic()

    def info(self) -> dict[str, object]:
        return {
            "pid": os.getpid(),
            "platform": platform.platform(),
            "python_version": platform.python_version(),
        }

    def metrics(self) -> dict[str, object]:
        return {
            **read_memory(self.worker_pid()),
            "uptime_seconds": round(time.monotonic() - self.started_at, 3),
            "process_max_rss_bytes": int(
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                * (1 if platform.system() == "Darwin" else 1024)
            ),
            "disk_free_bytes": shutil.disk_usage(self.data_directory).free,
        }

    def archive(self, report: dict[str, object]) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("diagnostics.json", json.dumps(report, ensure_ascii=False, indent=2))
        return buffer.getvalue()
