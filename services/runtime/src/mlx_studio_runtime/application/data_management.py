"""Task projection and backup barrier; data owners provide their own snapshots."""

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.coding_gateway import CodingGateway
from mlx_studio_runtime.application.data_admission import DataAdmission
from mlx_studio_runtime.application.downloads import Downloads
from mlx_studio_runtime.application.job_scheduler import JobScheduler
from mlx_studio_runtime.application.queries import Queries
from mlx_studio_runtime.application.task_completion import finish_owned_task
from mlx_studio_runtime.application.task_projection import link_task_parents, runtime_task
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class DataManagement:
    def __init__(
        self,
        queries: Queries,
        coding: CodingGateway,
        downloads: Downloads,
        scheduler: JobScheduler,
        preparation_busy: Callable[[], bool],
        export: Callable[[Path], Awaitable[Path]],
        prepare_profile: Callable[[str], Awaitable[None]],
        release_backup: Callable[[Path], None],
    ) -> None:
        self.queries, self.coding, self.downloads, self.scheduler = (
            queries,
            coding,
            downloads,
            scheduler,
        )
        self.preparation_busy, self.export = preparation_busy, export
        self.prepare_profile = prepare_profile
        self.release_backup = release_backup
        self.admission = DataAdmission()

    @property
    def busy(self) -> bool:
        return self.admission.closed

    async def tasks(self) -> list[dict[str, Any]]:
        result = [
            summary for job in self.queries.task_summaries() if (summary := runtime_task(job))
        ]
        try:
            result.extend(await self.coding.call("tasks.list", {}))
        except RuntimeFault:
            result.append(
                {
                    "owner": "coding",
                    "id": "host",
                    "state": "unavailable",
                    "phase": "连接中断",
                    "errorCode": "CODING_HOST_NOT_AVAILABLE",
                    "target": "/coding",
                    "title": "代码与工具服务",
                    "kind": "service",
                    "groupId": "coding:host",
                }
            )
        for download in self.downloads.list():
            result.append(
                {
                    "owner": "download",
                    "id": download["id"],
                    "state": download["state"],
                    "phase": f"本地缓存 {download.get('transferredBytes', 0) / 1024**2:.1f} MB",
                    "errorCode": download["errorCode"],
                    "target": "/models",
                    "title": download["repoId"],
                    "kind": "download",
                    "groupId": f"download:{download['id']}",
                }
            )
        return link_task_parents(result)

    def _require_idle(self) -> None:
        if self.scheduler.tasks or self.downloads.tasks or self.preparation_busy():
            raise RuntimeFault(RuntimeErrorInfo("BACKUP_BUSY", "请等待任务、下载和附件准备完成"))

    async def backup(self) -> Path:
        self._require_idle()
        async with self.admission.exclusive():
            self._require_idle()
            build = asyncio.create_task(self._export_snapshot())
            try:
                return await asyncio.shield(build)
            except asyncio.CancelledError:
                try:
                    archive = await finish_owned_task(build)
                except Exception:
                    pass  # The failing adapter owns cleanup of its partial output.
                else:
                    self.release_backup(archive)
                raise

    async def _export_snapshot(self) -> Path:
        node = await self.coding.call("data.export", {})
        return await self.export(Path(node["directory"]))

    async def restore_profile(self, identifier: str) -> None:
        self._require_idle()
        async with self.admission.exclusive():
            self._require_idle()
            await self.prepare_profile(identifier)
