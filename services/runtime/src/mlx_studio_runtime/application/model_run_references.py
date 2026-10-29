"""Atomic, event-loop-local reservations for parent runs and model configuration."""

from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from typing import Any

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


def run_model_ids(run: dict[str, Any]) -> frozenset[str]:
    snapshot = run["capabilitySnapshot"]
    selected = {tool["originalName"] for tool in snapshot["tools"] if tool["serverId"] == "builtin"}
    return frozenset(
        [run["modelId"]]
        + [
            snapshot["mediaBindings"][key]
            for action, key in (
                ("image_generate", "imageModelId"),
                ("speech_generate", "speechModelId"),
            )
            if action in selected
        ]
    )


class ModelRunReferences:
    def __init__(self) -> None:
        self._preparing: dict[object, frozenset[str]] = {}
        self._runs: dict[str, frozenset[str]] = {}
        self._changing: set[str] = set()

    def _check_changes(self, model_ids: frozenset[str]) -> None:
        if model_ids & self._changing:
            raise RuntimeFault(
                RuntimeErrorInfo("MODEL_IN_USE", "模型设置正在更新，请稍后重新提交任务", True)
            )

    @contextmanager
    def preparing(self, model_ids: Iterable[str]) -> Iterator[None]:
        models, owner = frozenset(model_ids), object()
        self._check_changes(models)
        # Check and reservation do not yield. Keep it across all preparation I/O.
        self._preparing[owner] = models
        try:
            yield
        finally:
            self._preparing.pop(owner, None)

    def retain(self, run_id: str, model_ids: Iterable[str]) -> None:
        models = frozenset(model_ids)
        self._check_changes(models)
        self._runs[run_id] = models

    def release(self, run_id: str) -> None:
        self._runs.pop(run_id, None)

    @contextmanager
    def changing(self, model_id: str) -> Iterator[None]:
        self._check_changes(frozenset((model_id,)))
        if any(model_id in models for models in (*self._preparing.values(), *self._runs.values())):
            raise RuntimeFault(
                RuntimeErrorInfo(
                    "MODEL_IN_USE",
                    "此模型仍被 Coding 或 Agent 任务引用，请等待结束或先停止任务",
                    True,
                )
            )
        # Admission sees this reservation even while settings wait for the Worker lease.
        self._changing.add(model_id)
        try:
            yield
        finally:
            self._changing.discard(model_id)
