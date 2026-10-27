"""Explicit fixtures for isolated acceptance databases, never normal application startup."""

from pathlib import Path

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.models import fake_text_manifest


def seed_fake_text(database_path: Path) -> None:
    store = SQLiteRepositories(database_path)
    try:
        store.models.upsert(fake_text_manifest().to_dict())
    finally:
        store.close()
