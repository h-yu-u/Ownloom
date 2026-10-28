"""Native text-engine measurements; unknown values are never estimated or zero-filled."""

import math
from typing import Literal, TypedDict, cast

GenerationSource = Literal["mlx-lm", "mlx-vlm"]


class GenerationStats(TypedDict):
    source: GenerationSource
    generationTokens: int | None
    generationTps: float | None
    promptTokens: int | None
    promptTps: float | None
    cachedTokens: int | None


def read_generation_stats(value: object) -> GenerationStats | None:
    if not isinstance(value, dict):
        return None
    fields = cast(dict[str, object], value)
    source = fields.get("source")
    if not isinstance(source, str) or source not in {"mlx-lm", "mlx-vlm"}:
        return None
    stats: GenerationStats = {
        "source": cast(GenerationSource, source),
        "generationTokens": _count(fields.get("generationTokens")),
        "generationTps": _rate(fields.get("generationTps")),
        "promptTokens": _count(fields.get("promptTokens")),
        "promptTps": _rate(fields.get("promptTps")),
        "cachedTokens": _count(fields.get("cachedTokens")),
    }
    return (
        stats if any(item is not None for key, item in stats.items() if key != "source") else None
    )


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _rate(value: object) -> float | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        rate = float(value)
    except OverflowError:
        return None
    return rate if math.isfinite(rate) and rate >= 0 else None
