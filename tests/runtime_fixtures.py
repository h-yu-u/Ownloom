"""Explicit test-only model registration; production starts without demo models."""

from pathlib import Path

from fastapi import FastAPI
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import (
    SQLiteRepositories,
)
from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.image_generation import fake_image_manifest_dict
from mlx_studio_runtime.domain.models import (
    ModelManifest,
    fake_text_manifest,
    manifest_from_dict,
)
from mlx_studio_runtime.domain.speech import SpeechCapabilities, SpeechOperation
from mlx_studio_runtime.entrypoints.http.app import create_app


def seed_fake_models(store: SQLiteRepositories) -> None:
    audio = ModelManifest(
        id="builtin-fake-audio",
        display_name="Fake Speech Engine (测试音，仅用于开发)",
        source="builtin",
        local_path="fake://audio",
        engine="fake",
        task="text-to-speech",
        input_modalities=("text", "audio"),
        output_modalities=("audio",),
        compatibility_status="supported",
        speech=SpeechCapabilities(
            "fake",
            "custom_voice",
            (
                SpeechOperation("preset", preset_speakers=("demo",)),
                SpeechOperation("clone"),
            ),
            "validated",
            "fake-v1",
        ),
    )
    for manifest in (
        fake_text_manifest(),
        manifest_from_dict(fake_image_manifest_dict()),
        audio,
    ):
        store.models.upsert(manifest.to_dict())


def seed_fake_database(path: Path) -> None:
    store = SQLiteRepositories(path)
    try:
        seed_fake_models(store)
    finally:
        store.close()


def create_test_app(
    session_token: str,
    database_path: Path,
    external_api_enabled: bool | None = None,
) -> FastAPI:
    seed_fake_database(database_path)
    return create_app(session_token, database_path, external_api_enabled)


def create_test_runtime(
    store: SQLiteRepositories, runtime_source: Path
) -> RuntimeApplication:
    seed_fake_models(store)
    return RuntimeApplication(store, runtime_source)
