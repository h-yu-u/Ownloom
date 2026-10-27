"""Read-only runtime projections and privacy-limited diagnostic reports."""

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from mlx_studio_runtime import PROTOCOL_VERSION


@dataclass(frozen=True)
class RuntimeSnapshot:
    state: str
    active_model_id: str | None
    worker_restarts: int
    active_jobs: int
    model_engines: tuple[str, ...]
    job_states: tuple[str, ...]
    event_sequence: int
    instance_id: str
    worker_epoch: int = 0
    worker_phase: str = "stopped"
    loading_model_id: str | None = None


class DiagnosticEnvironment(Protocol):
    def info(self) -> dict[str, object]: ...
    def metrics(self) -> dict[str, object]: ...
    def archive(self, report: dict[str, object]) -> bytes: ...


class RuntimeOverview:
    def __init__(
        self, snapshot: Callable[[], RuntimeSnapshot], environment: DiagnosticEnvironment
    ) -> None:
        self.snapshot = snapshot
        self.environment = environment

    def health(self) -> dict[str, object]:
        return {
            "status": "ok",
            "state": self.snapshot().state,
            "protocol_version": PROTOCOL_VERSION,
        }

    def info(self) -> dict[str, object]:
        snapshot = self.snapshot()
        return dict(
            self.environment.info(),
            version="0.1.0",
            protocol_version=PROTOCOL_VERSION,
            state=snapshot.state,
            active_model_id=snapshot.active_model_id,
            event_sequence=snapshot.event_sequence,
            instance_id=snapshot.instance_id,
            worker_epoch=snapshot.worker_epoch,
            worker_phase=snapshot.worker_phase,
            loading_model_id=snapshot.loading_model_id,
        )

    def metrics(self) -> dict[str, object]:
        snapshot = self.snapshot()
        return dict(
            self.environment.metrics(),
            worker_restarts=snapshot.worker_restarts,
            active_jobs=snapshot.active_jobs,
        )

    def diagnostics(self) -> dict[str, object]:
        snapshot = self.snapshot()
        return {
            "runtime_state": snapshot.state,
            "protocol_version": PROTOCOL_VERSION,
            "registered_models": len(snapshot.model_engines),
            "jobs_by_state": dict(Counter(snapshot.job_states)),
        }

    def bundle(self) -> bytes:
        snapshot = self.snapshot()
        report = dict(
            self.environment.info(),
            runtime_version="0.1.0",
            protocol_version=PROTOCOL_VERSION,
            uptime_seconds=self.environment.metrics()["uptime_seconds"],
            runtime_state=snapshot.state,
            registered_models_by_engine=dict(Counter(snapshot.model_engines)),
            jobs_by_state=dict(Counter(snapshot.job_states)),
        )
        report.pop("pid", None)
        return self.environment.archive(report)
