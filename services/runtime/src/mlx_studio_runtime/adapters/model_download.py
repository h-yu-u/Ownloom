"""Compatibility call using the managed, cancellable transfer process."""

from pathlib import Path

from mlx_studio_runtime.adapters.download_transfer import transfer


async def download_model(repo_id: str, revision: str | None) -> tuple[Path, str]:
    return await transfer(repo_id, revision, lambda _: None)
