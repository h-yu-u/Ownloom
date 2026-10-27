"""Background job persistence."""

from __future__ import annotations

import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.attachment_reference_repository import (
    AttachmentReferences,
)
from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class JobRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def save(self, item: dict[str, Any]) -> None:
        now = int(time.time())
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO jobs(id,kind,state,model_id,request_json,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (
                    item["id"],
                    item["kind"],
                    item["state"],
                    item.get("modelId"),
                    json.dumps(item.get("request", {})),
                    now,
                    now,
                ),
            )
            if item["kind"] == "image":
                request = item.get("request", {})
                refs = AttachmentReferences(self.database)
                refs.job(
                    item["id"],
                    "image_reference",
                    [{"id": value} for value in request.get("reference_ids", [])],
                )
                if request.get("mask_id"):
                    refs.job(item["id"], "image_mask", [{"id": request["mask_id"]}])

    def save_result(self, job_id: str, result: dict[str, Any]) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO inference_results(job_id,result_json) VALUES(?,?)",
                (job_id, json.dumps(result, ensure_ascii=False)),
            )

    def update(self, job_id: str, state: str, error_code: str | None = None) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE jobs SET "
                "state=?,error_code=?,updated_at=?,projection_version=projection_version+1 "
                "WHERE id=?",
                (state, error_code, int(time.time()), job_id),
            )

    def set_phase(self, job_id: str, phase: str) -> int:
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE jobs SET phase=?,projection_version=projection_version+1,updated_at=? "
                "WHERE id=? AND state IN ('queued','preparing','running')",
                (phase, int(time.time()), job_id),
            )
            row = connection.execute(
                "SELECT projection_version FROM jobs WHERE id=?", (job_id,)
            ).fetchone()
            return int(row[0]) if row else 0

    def recover_interrupted(self, error_code: str) -> int:
        with self.database.transaction() as connection:
            cursor = connection.execute(
                "UPDATE jobs SET state='failed',error_code=?,updated_at=? "
                "WHERE state IN ('queued','preparing','running','cancelling')",
                (error_code, int(time.time())),
            )
        return cursor.rowcount

    def list(self) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT id,kind,state,model_id,error_code,created_at,updated_at "
            "FROM jobs ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
        return [
            {
                "id": row[0],
                "kind": row[1],
                "state": row[2],
                "modelId": row[3],
                "errorCode": row[4],
                "createdAt": row[5],
                "updatedAt": row[6],
            }
            for row in rows
        ]

    def task_summaries(self) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "WITH summaries AS (SELECT j.*,j.rowid AS sort_order,"
            "CASE WHEN json_valid(request_json) THEN "
            "CASE WHEN json_type(request_json,'$.conversationId')='text' "
            "THEN json_extract(request_json,'$.conversationId') END END AS session_id FROM jobs j) "
            "SELECT j.id,j.kind,j.state,j.error_code,COALESCE(NULLIF(j.phase,''),j.state),"
            "j.session_id,c.title,(SELECT run_id FROM capability_dispatches p "
            "WHERE p.job_id=j.id LIMIT 1),j.created_at*1000 "
            "FROM summaries j LEFT JOIN conversations c ON c.id=j.session_id "
            "ORDER BY j.state IN ('queued','preparing','running','cancelling') DESC,"
            "j.created_at DESC,j.sort_order DESC LIMIT 200"
        ).fetchall()
        return [
            dict(
                zip(
                    (
                        "id",
                        "kind",
                        "state",
                        "errorCode",
                        "phase",
                        "sessionId",
                        "title",
                        "parentId",
                        "createdAt",
                    ),
                    row,
                    strict=True,
                )
            )
            for row in rows
        ]

    def get(self, job_id: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT id,kind,state,model_id,error_code,request_json,phase,projection_version "
            "FROM jobs WHERE id=?",
            (job_id,),
        ).fetchone()
        if row is None:
            return None
        message = self.database.connection.execute(
            "SELECT content FROM messages WHERE role='assistant' AND json_valid(parameters_json) "
            "AND json_extract(parameters_json,'$.jobId')=? ORDER BY rowid DESC LIMIT 1",
            (job_id,),
        ).fetchone()
        return {
            "id": row[0],
            "kind": row[1],
            "state": row[2],
            "modelId": row[3],
            "errorCode": row[4],
            "request": json.loads(row[5]),
            "phase": row[6],
            "projectionVersion": row[7],
            "resultText": message[0] if message else "",
        }
