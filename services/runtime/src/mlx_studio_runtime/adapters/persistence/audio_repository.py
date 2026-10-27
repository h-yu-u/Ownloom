"""Incremental speech assets, reusable voices and immutable artifact snapshots."""

import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class AudioRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def save_asset(self, item: dict[str, Any]) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO audio_assets(id,relative_path,metadata_json) VALUES(?,?,?)",
                (item["id"], item["relative_path"], json.dumps(item)),
            )

    def asset(self, asset_id: str) -> dict[str, Any] | None:
        return self._get("audio_assets", asset_id)

    def references(self) -> list[dict[str, Any]]:
        return [
            json.loads(row[0])
            for row in self.database.connection.execute(
                "SELECT metadata_json FROM audio_assets "
                "WHERE json_extract(metadata_json,'$.role')='reference' ORDER BY rowid DESC"
            )
        ]

    def voice(self, voice_id: str) -> dict[str, Any] | None:
        return self._get("voice_profiles", voice_id)

    def artifact(self, artifact_id: str) -> dict[str, Any] | None:
        return self._get("audio_artifacts", artifact_id)

    def _get(self, table: str, identifier: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            f"SELECT metadata_json FROM {table} WHERE id=?", (identifier,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def voices(self) -> list[dict[str, Any]]:
        return [
            json.loads(row[0])
            for row in self.database.connection.execute(
                "SELECT metadata_json FROM voice_profiles ORDER BY rowid DESC"
            )
        ]

    def save_voice(self, item: dict[str, Any]) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO voice_profiles(id,asset_id,metadata_json) VALUES(?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json",
                (item["id"], item["reference_asset_id"], json.dumps(item)),
            )

    def delete_voice(self, voice_id: str) -> None:
        with self.database.transaction() as connection:
            connection.execute("DELETE FROM voice_profiles WHERE id=?", (voice_id,))

    def asset_in_use(self, asset_id: str, excluding_voice_id: str | None = None) -> bool:
        voice = self.database.connection.execute(
            "SELECT 1 FROM voice_profiles WHERE asset_id=? AND (? IS NULL OR id != ?) LIMIT 1",
            (asset_id, excluding_voice_id, excluding_voice_id),
        ).fetchone()
        job = self.database.connection.execute(
            "SELECT 1 FROM jobs WHERE kind='audio' "
            "AND state NOT IN ('succeeded','failed','cancelled') "
            "AND json_extract(request_json,'$.voice_snapshot.reference_asset_id')=? LIMIT 1",
            (asset_id,),
        ).fetchone()
        artifact = self.database.connection.execute(
            "SELECT 1 FROM audio_artifacts WHERE asset_id=? LIMIT 1", (asset_id,)
        ).fetchone()
        return bool(voice or job or artifact)

    def delete_asset(self, asset_id: str) -> None:
        with self.database.transaction() as connection:
            connection.execute("DELETE FROM audio_assets WHERE id=?", (asset_id,))

    def save_artifact(self, item: dict[str, Any]) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO audio_artifacts(id,job_id,asset_id,metadata_json) VALUES(?,?,?,?)",
                (item["id"], item["job_id"], item["asset_id"], json.dumps(item)),
            )

    def artifacts(self, limit: int, offset: int) -> list[dict[str, Any]]:
        return [
            json.loads(row[0])
            for row in self.database.connection.execute(
                "SELECT metadata_json FROM audio_artifacts ORDER BY rowid DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        ]

    def delete_artifact(self, artifact_id: str) -> None:
        with self.database.transaction() as connection:
            connection.execute("DELETE FROM audio_artifacts WHERE id=?", (artifact_id,))

    def find_submission(self, request_id: str) -> tuple[str, str] | None:
        row = self.database.connection.execute(
            "SELECT id,json_extract(request_json,'$.requestDigest') FROM jobs "
            "WHERE kind='audio' AND json_extract(request_json,'$.clientRequestId')=?",
            (request_id,),
        ).fetchone()
        return (str(row[0]), str(row[1])) if row else None

    def jobs(self, job_id: str | None = None) -> list[dict[str, Any]]:
        where = "j.kind='audio'" + (" AND j.id=?" if job_id else "")
        rows = self.database.connection.execute(
            "SELECT j.id,j.state,j.request_json,j.error_code,j.created_at,a.id FROM jobs j "
            "LEFT JOIN audio_artifacts a ON a.job_id=j.id "
            f"WHERE {where} ORDER BY j.rowid DESC LIMIT 100",
            (job_id,) if job_id else (),
        )
        return [
            dict(
                json.loads(row[2]),
                id=row[0],
                state=row[1],
                error_code=row[3],
                created_at=row[4],
                artifact_id=row[5],
            )
            for row in rows
        ]


def migrate_audio(database: SQLiteDatabase) -> None:
    database.connection.executescript("""
        CREATE TABLE IF NOT EXISTS audio_assets (
          id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, metadata_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS voice_profiles (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES audio_assets(id) ON DELETE RESTRICT,
          metadata_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audio_artifacts (
          id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
          asset_id TEXT NOT NULL REFERENCES audio_assets(id) ON DELETE RESTRICT,
          metadata_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS audio_submission_request
          ON jobs(json_extract(request_json, '$.clientRequestId'))
          WHERE kind='audio' AND json_extract(request_json, '$.clientRequestId') IS NOT NULL;
    """)
    database.connection.execute(
        "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,?)",
        (int(time.time()),),
    )
    database.connection.commit()
