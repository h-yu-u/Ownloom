"""Task projection and backup barrier; data owners provide their own snapshots."""

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.coding_gateway import CodingGateway
from mlx_studio_runtime.application.downloads import Downloads
from mlx_studio_runtime.application.job_scheduler import JobScheduler
from mlx_studio_runtime.application.queries import Queries
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
    ) -> None:
        self.queries, self.coding, self.downloads, self.scheduler = (
            queries,
            coding,
            downloads,
            scheduler,
        )
        self.preparation_busy, self.export = preparation_busy, export
        self.prepare_profile = prepare_profile
        self.busy = False

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

    async def backup(self) -> Path:
        if self.scheduler.tasks or self.downloads.tasks or self.busy or self.preparation_busy():
            raise RuntimeFault(RuntimeErrorInfo("BACKUP_BUSY", "请等待任务、下载和附件准备完成"))
        self.busy = True
        try:
            node = await self.coding.call("data.export", {})
            return await self.export(Path(node["directory"]))
        finally:
            self.busy = False

    async def restore_profile(self, identifier: str) -> None:
        if self.scheduler.tasks or self.downloads.tasks or self.busy or self.preparation_busy():
            raise RuntimeFault(RuntimeErrorInfo("BACKUP_BUSY", "请等待任务、下载和附件准备完成"))
        self.busy = True
        try:
            await self.prepare_profile(identifier)
        finally:
            self.busy = False
