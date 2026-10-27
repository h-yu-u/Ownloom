"""Stable application error codes independent of upstream exception text."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RuntimeErrorInfo:
    code: str
    message: str
    retryable: bool = False
    details: dict[str, str] | None = None


class RuntimeFault(Exception):
    def __init__(self, info: RuntimeErrorInfo) -> None:
        super().__init__(info.message)
        self.info = info


def error_payload(error: RuntimeFault, request_id: str) -> dict[str, object]:
    return {
        "error": {
            "code": error.info.code,
            "message": error.info.message,
            "retryable": error.info.retryable,
            "phase": recovery_for_code(error.info.code)[0],
            "recoveryActions": recovery_for_code(error.info.code)[1],
            "details": error.info.details or {},
            "request_id": request_id,
        }
    }


class ContextRebuildRequired(RuntimeError):
    """A completed driver rejection requests one rebuild after releasing its lease."""


def recovery_for_code(code: str) -> tuple[str, list[str]]:
    if code in {"MODEL_NOT_FOUND", "MODEL_NOT_READY", "MODEL_INPUT_UNSUPPORTED"}:
        return "admission", ["select_model"]
    if code == "MODEL_LOAD_FAILED":
        return "loading", ["retry_load", "select_model"]
    if "CONTEXT" in code and ("BUDGET" in code or "COMPACTION" in code):
        return "context", ["reduce_context", "select_model", "new_conversation"]
    if code.startswith("WEB_"):
        return "preparation", ["retry_web", "answer_locally"]
    if code in {"CODING_HOST_NOT_AVAILABLE", "RUNTIME_NOT_AVAILABLE", "WORKER_NOT_AVAILABLE"}:
        return "connection", ["reconnect"]
    if code.startswith("DOWNLOAD_") or code == "MODEL_DOWNLOAD_FAILED":
        return "download", ["resume_download"]
    return "execution", []
