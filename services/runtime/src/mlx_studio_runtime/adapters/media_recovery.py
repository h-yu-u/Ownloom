"""Quarantine interrupted managed media commits without deleting user model files."""

import uuid

from mlx_studio_runtime.adapters.attachment_gc import AttachmentGC, recover_derivatives
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


def recover_media(store: SQLiteDatabase) -> int:
    AttachmentGC(store).recover()
    known = {
        str(row[0]) for row in store.connection.execute("SELECT relative_path FROM attachments")
    }
    known.update(
        str(row[0]) for row in store.connection.execute("SELECT relative_path FROM artifacts")
    )
    if store.connection.execute("SELECT 1 FROM sqlite_master WHERE name='audio_assets'").fetchone():
        known.update(
            str(row[0])
            for row in store.connection.execute("SELECT relative_path FROM audio_assets")
        )
    recovered = recover_derivatives(store)
    for subdirectory in [
        "attachments",
        "images",
        "images/.pending",
        "audio/references",
        "audio/generated",
        "audio/staging",
    ]:
        directory = store.media_path / subdirectory
        if not directory.is_dir():
            continue
        for path in directory.iterdir():
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(store.media_path).as_posix()
            if relative in known:
                continue
            identifier = path.name.removeprefix(".").removesuffix(".upload").removesuffix(".png")
            identifier = identifier.removesuffix(".wav")
            try:
                uuid.UUID(identifier)
            except ValueError:
                continue
            target = store.media_path / ".recovery" / subdirectory / path.name
            target.parent.mkdir(parents=True, exist_ok=True)
            path.replace(target)
            recovered += 1
    return recovered
