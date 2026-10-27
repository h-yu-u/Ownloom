"""Runtime and model lifecycle reducers."""

from enum import StrEnum


class RuntimeState(StrEnum):
    STOPPED = "stopped"
    STARTING = "starting"
    READY = "ready"
    DEGRADED = "degraded"
    STOPPING = "stopping"
    FAILED = "failed"


class ModelState(StrEnum):
    DISCOVERED = "discovered"
    DOWNLOADING = "downloading"
    AVAILABLE = "available"
    LOADING = "loading"
    LOADED = "loaded"
    UNLOADING = "unloading"
    ERROR = "error"


def transition_runtime(state: RuntimeState, event: str) -> RuntimeState:
    transitions = {
        (RuntimeState.STOPPED, "start"): RuntimeState.STARTING,
        (RuntimeState.STARTING, "ready"): RuntimeState.READY,
        (RuntimeState.STARTING, "fail"): RuntimeState.FAILED,
        (RuntimeState.READY, "worker_lost"): RuntimeState.DEGRADED,
        (RuntimeState.DEGRADED, "worker_ready"): RuntimeState.READY,
        (RuntimeState.READY, "stop"): RuntimeState.STOPPING,
        (RuntimeState.DEGRADED, "stop"): RuntimeState.STOPPING,
        (RuntimeState.FAILED, "start"): RuntimeState.STARTING,
        (RuntimeState.STOPPING, "stopped"): RuntimeState.STOPPED,
    }
    try:
        return transitions[(state, event)]
    except KeyError as error:
        raise ValueError(f"Invalid Runtime transition: {state.value} + {event}") from error


def transition_model(state: ModelState, event: str) -> ModelState:
    transitions = {
        (ModelState.DISCOVERED, "download"): ModelState.DOWNLOADING,
        (ModelState.DOWNLOADING, "available"): ModelState.AVAILABLE,
        (ModelState.AVAILABLE, "load"): ModelState.LOADING,
        (ModelState.LOADING, "loaded"): ModelState.LOADED,
        (ModelState.LOADED, "unload"): ModelState.UNLOADING,
        (ModelState.UNLOADING, "available"): ModelState.AVAILABLE,
    }
    if event == "fail" and state is not ModelState.ERROR:
        return ModelState.ERROR
    try:
        return transitions[(state, event)]
    except KeyError as error:
        raise ValueError(f"Invalid model transition: {state.value} + {event}") from error
