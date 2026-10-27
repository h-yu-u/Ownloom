"""Create explicit fake fixtures in a new isolated acceptance database, never user data."""

import argparse
from pathlib import Path

from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.domain.image_generation import fake_image_manifest_dict
from mlx_studio_runtime.domain.models import fake_text_manifest
from mlx_studio_runtime.domain.speech import SpeechCapabilities, SpeechOperation


def seed(path: Path) -> None:
    if path.exists():
        raise ValueError("Refusing to overwrite an existing acceptance database")
    store = SQLiteRepositories(path)
    try:
        audio = fake_text_manifest().to_dict()
        audio.update(
            id="builtin-fake-audio",
            displayName="Acceptance Speech Fixture",
            localPath="fake://audio",
            task="text-to-speech",
            outputModalities=["audio"],
            speech=SpeechCapabilities(
                "fake",
                "custom_voice",
                (
                    SpeechOperation("preset", preset_speakers=("demo",)),
                    SpeechOperation("clone"),
                ),
                "validated",
                "fake-v1",
            ).to_dict(),
        )
        for model in (
            fake_text_manifest().to_dict(),
            fake_image_manifest_dict(),
            audio,
        ):
            # Keep explicit fixtures across the v6 built-in-demo cleanup migration.
            model["source"] = "local"
            store.models.upsert(model)
    finally:
        store.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    seed(parser.parse_args().database.resolve())
