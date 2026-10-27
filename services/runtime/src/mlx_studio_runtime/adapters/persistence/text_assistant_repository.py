"""Text assistant attempts retain request identity and completed editable drafts."""

import json
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class TextAssistantRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database
        database.connection.executescript("""
            CREATE TABLE IF NOT EXISTS text_assistant_attempts (
                submission_id TEXT PRIMARY KEY, intent TEXT NOT NULL,
                job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id), result TEXT
            );
            INSERT OR IGNORE INTO schema_migrations(version,applied_at)
                VALUES(8,CAST(strftime('%s','now') AS INTEGER));
        """)

    def find(self, submission_id: str) -> tuple[str, str] | None:
        row = self.database.connection.execute(
            "SELECT intent,job_id FROM text_assistant_attempts WHERE submission_id=?",
            (submission_id,),
        ).fetchone()
        return (str(row[0]), str(row[1])) if row else None

    def save(self, submission_id: str, intent: str, job_id: str) -> None:
        self.database.connection.execute(
            "INSERT INTO text_assistant_attempts(submission_id,intent,job_id) VALUES(?,?,?)",
            (submission_id, intent, job_id),
        )

    def complete(self, job_id: str, result: str) -> None:
        self.database.connection.execute(
            "UPDATE text_assistant_attempts SET result=? WHERE job_id=?",
            (json.dumps({"text": result}), job_id),
        )

    def result(self, job_id: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT result FROM text_assistant_attempts WHERE job_id=?", (job_id,)
        ).fetchone()
        return json.loads(row[0]) if row and row[0] else None
