"""Download validation and registration; no network or filesystem implementation."""

import asyncio
import re
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Protocol

from mlx_studio_runtime.application.model_catalog import ModelCatalog
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class DownloadRecords(Protocol):
    def list(self) -> list[dict[str, Any]]: ...
    def get(self, identifier: str) -> dict[str, Any]: ...
    def save(self, item: dict[str, Any]) -> None: ...


class Downloads:
    def __init__(
        self,
        download: Callable[[str, str | None], Awaitable[tuple[Path, str]]],
        catalog: ModelCatalog,
        records: DownloadRecords | None = None,
        transfer: Callable[
            [str, str | None, Callable[[dict[str, Any]], None]], Awaitable[tuple[Path, str]]
        ]
        | None = None,
    ) -> None:
        self.download = download
        self.catalog = catalog
        self.records, self.transfer = records, transfer
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.slots = asyncio.Semaphore(2)

    async def pull(self, repo_id: str, revision: str | None) -> dict[str, str]:
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo_id) or ".." in repo_id:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_REPO_ID_INVALID", "模型仓库编号无效"))
        path, resolved_revision = await self.download(repo_id, revision)
        manifest = await self.catalog.scan_model(
            path,
            source="huggingface",
            revision=resolved_revision,
            display_name=repo_id,
            managed_installation=True,
        )
        return {"modelId": str(manifest["id"]), "state": "available"}

    def list(self) -> list[dict[str, Any]]:
        return self.records.list() if self.records else []

    def start(self, repo: str, revision: str | None = None) -> dict[str, Any]:
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo) or ".." in repo:
            raise RuntimeFault(RuntimeErrorInfo("MODEL_REPO_ID_INVALID", "模型仓库编号无效"))
        assert self.records is not None
        if len(self.tasks) >= 32:
            raise RuntimeFault(
                RuntimeErrorInfo("DOWNLOAD_QUEUE_FULL", "下载队列已满，请等待或暂停任务", True)
            )
        existing = next(
            (
                item
                for item in self.records.list()
                if item["repoId"] == repo
                and item.get("requestedRevision") == revision
                and item["state"] in {"queued", "downloading", "verifying"}
            ),
            None,
        )
        if existing:
            return existing
        item = {
            "id": str(uuid.uuid4()),
            "repoId": repo,
            "requestedRevision": revision,
            "revision": revision,
            "state": "queued",
            "pausedByUser": False,
            "files": [],
            "verifiedFiles": [],
            "errorCode": None,
            "transferredBytes": 0,
        }
        self.records.save(item)
        self.tasks[item["id"]] = asyncio.create_task(self._run(item["id"]))
        return item

    async def _run(self, identifier: str) -> None:
        assert self.records is not None
        item = self.records.get(identifier)

        def update(event: dict[str, Any]) -> None:
            if event["type"] == "plan":
                item.update(revision=event["revision"], files=event["files"], path=event["path"])
            elif event["type"] == "progress":
                item.update(
                    transferredBytes=event["transferredBytes"], progressOrigin="local_cache"
                )
            elif event["type"] == "verifying":
                item["state"] = "verifying"
            if self.records:
                self.records.save(item)

        try:
            async with self.slots, asyncio.timeout(24 * 3600):
                item["state"], item["errorCode"] = "downloading", None
                self.records.save(item)
                path, revision = (
                    await self.transfer(item["repoId"], item["revision"], update)
                    if self.transfer
                    else await self.download(item["repoId"], item["revision"])
                )
            model = await self.catalog.scan_model(
                path,
                source="huggingface",
                revision=revision,
                display_name=item["repoId"],
                managed_installation=True,
            )
            item.update(
                state="available",
                modelId=model["id"],
                revision=revision,
                verifiedFiles=[file["path"] for file in item["files"]],
                transferredBytes=sum(file.get("size") or 0 for file in item["files"]),
            )
        except asyncio.CancelledError:
            # The transfer await has already confirmed child exit.
            current = self.records.get(identifier)
            item.update(
                state="cancelled" if current.get("cancelRequested") else "paused",
                pausedByUser=current.get("pausedByUser", False),
            )
        except Exception as error:  # Download task boundary.
            item.update(
                state="failed",
                errorCode=error.info.code
                if isinstance(error, RuntimeFault)
                else "MODEL_DOWNLOAD_FAILED",
            )
        finally:
            self.records.save(item)
            self.tasks.pop(identifier, None)

    async def stop(self, identifier: str, cancel: bool = False) -> dict[str, Any]:
        assert self.records is not None
        item = self.records.get(identifier)
        if item["state"] in {"available", "cancelled"}:
            return item
        item.update(pausedByUser=not cancel, cancelRequested=cancel)
        self.records.save(item)
        task = self.tasks.get(identifier)
        if task:
            if not task.cancelling():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            item = self.records.get(identifier)
            if item["state"] in {"queued", "downloading", "verifying"}:
                item["state"] = "cancelled" if cancel else "paused"
                self.records.save(item)
        else:
            item["state"] = "cancelled" if cancel else "paused"
            self.records.save(item)
        return self.records.get(identifier)

    def resume(self, identifier: str) -> dict[str, Any]:
        assert self.records is not None
        item = self.records.get(identifier)
        if identifier in self.tasks or item["state"] not in {"paused", "failed"}:
            return item
        item.update(state="queued", pausedByUser=False, cancelRequested=False)
        self.records.save(item)
        self.tasks[identifier] = asyncio.create_task(self._run(identifier))
        return item

    async def close(self) -> None:
        for identifier in tuple(self.tasks):
            await self.stop(identifier)
