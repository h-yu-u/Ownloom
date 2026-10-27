"""Shared budget contract. Estimates select context; drivers make the final decision."""

import hashlib
import json
import re
from dataclasses import asdict, dataclass

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

SAFETY_RESERVE = 128


def estimate_tokens(text: str) -> int:
    # Explicit estimate, never used to claim exact tokenizer usage.
    runs = re.findall(r"[\u3400-\u9fff]|[^\u3400-\u9fff]+", text)
    return sum(1 if len(run) == 1 else (len(run.encode()) + 2) // 3 for run in runs)


def output_reserve(limit: int, requested: int | None = None) -> int:
    return requested if requested is not None else min(4096, max(512, limit // 8))


@dataclass(frozen=True)
class ContextBudget:
    contextLimit: int
    inputTokens: int
    outputReserve: int
    safetyReserve: int = SAFETY_RESERVE
    measurement: str = "estimated"
    tokenizerRevision: str = "estimate-utf8-cjk-v1"
    templateRevision: str = "chat-v1"
    toolSchemaDigest: str = ""

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    def validate(self) -> None:
        if self.inputTokens + self.outputReserve + self.safetyReserve > self.contextLimit:
            raise RuntimeFault(
                RuntimeErrorInfo(
                    "CONTEXT_BUDGET_EXCEEDED",
                    "输入和输出预留超过模型窗口，请压缩历史、减少资料或更换模型",
                    details={key: str(value) for key, value in self.to_dict().items()},
                )
            )


def schema_digest(tools: object) -> str:
    return hashlib.sha256(
        json.dumps(tools, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
