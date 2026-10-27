"""Validate public MLX catalog metadata without importing an HTTP or Hub client."""

import re
from dataclasses import dataclass
from typing import cast

REPO_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*")


@dataclass(frozen=True)
class HubModel:
    repo_id: str
    downloads: int
    likes: int
    task: str | None
    updated_at: str | None


def read_hub_models(payload: object) -> tuple[HubModel, ...]:
    if not isinstance(payload, list):
        raise ValueError("Expected a Hugging Face model list")
    models: list[HubModel] = []
    seen: set[str] = set()
    for item in cast(list[object], payload):
        if not isinstance(item, dict):
            continue
        fields = cast(dict[str, object], item)
        repo_id = fields.get("id")
        tags = fields.get("tags")
        is_mlx = fields.get("library_name") == "mlx" or (
            isinstance(tags, list) and "mlx" in cast(list[object], tags)
        )
        if not isinstance(repo_id, str) or not REPO_ID_PATTERN.fullmatch(repo_id):
            continue
        if not is_mlx or fields.get("private") or fields.get("gated") or repo_id in seen:
            continue
        models.append(
            HubModel(
                repo_id=repo_id,
                downloads=_count(fields.get("downloads")),
                likes=_count(fields.get("likes")),
                task=_text(fields.get("pipeline_tag")),
                updated_at=_text(fields.get("lastModified")),
            )
        )
        seen.add(repo_id)
    return tuple(models)


def _count(value: object) -> int:
    return max(0, value) if isinstance(value, int) and not isinstance(value, bool) else 0


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None
