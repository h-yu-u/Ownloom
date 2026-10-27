"""Persist image artifacts and recover image task snapshots from the shared job table."""

import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.attachment_reference_repository import (
    AttachmentReferences,
)
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class ImageRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def save(
        self, artifact_id: str, job_id: str, relative_path: str, metadata: dict[str, object]
    ) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO artifacts(id,job_id,kind,relative_path,metadata_json,created_at) "
                "VALUES(?,?,'image',?,?,?)",
                (artifact_id, job_id, relative_path, json.dumps(metadata), int(time.time())),
            )
            refs = AttachmentReferences(self.database)
            reference_ids = metadata.get("reference_ids", [])
            if isinstance(reference_ids, list):
                refs.artifact(
                    artifact_id, "image_reference", [str(value) for value in reference_ids]
                )
            if metadata.get("mask_id"):
                refs.artifact(artifact_id, "image_mask", [str(metadata["mask_id"])])

    def list_artifacts(self, limit: int = 24, offset: int = 0) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT id,job_id,relative_path,metadata_json,created_at FROM artifacts "
            "WHERE kind='image' AND recycled_at IS NULL "
            "ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [
            dict(
                json.loads(row[3]),
                id=row[0],
                job_id=row[1],
                relative_path=row[2],
                created_at=row[4],
            )
            for row in rows
        ]

    def get(self, artifact_id: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT id,job_id,relative_path,metadata_json,created_at FROM artifacts "
            "WHERE id=? AND kind='image'",
            (artifact_id,),
        ).fetchone()
        return (
            None
            if row is None
            else dict(
                json.loads(row[3]),
                id=row[0],
                job_id=row[1],
                relative_path=row[2],
                created_at=row[4],
            )
        )

    def jobs(self, job_id: str | None = None) -> list[dict[str, Any]]:
        where = "j.kind='image'" + (" AND j.id=?" if job_id else "")
        rows = self.database.connection.execute(
            "SELECT j.id,j.state,j.request_json,j.error_code,j.created_at,a.id FROM jobs j "
            "LEFT JOIN artifacts a ON a.job_id=j.id AND a.kind='image' "
            f"WHERE {where} ORDER BY j.created_at DESC,j.rowid DESC LIMIT 100",
            (job_id,) if job_id else (),
        ).fetchall()
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

    def find_submission(self, request_id: str) -> tuple[str, str] | None:
        row = self.database.connection.execute(
            "SELECT id,json_extract(request_json,'$.requestDigest') FROM jobs "
            "WHERE kind='image' AND json_extract(request_json,'$.clientRequestId')=?",
            (request_id,),
        ).fetchone()
        return (str(row[0]), str(row[1])) if row else None
