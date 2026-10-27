"""Durable scope and dispatch metadata. Ephemeral bearer values are never persisted."""

import json
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class CapabilityLedger:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database
        database.connection.executescript("""
            CREATE TABLE IF NOT EXISTS capability_scopes (
                run_id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL,
                snapshot TEXT NOT NULL, model_steps INTEGER NOT NULL DEFAULT 0,
                media_calls INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS capability_dispatches (
                run_id TEXT NOT NULL REFERENCES capability_scopes(run_id),
                invocation_id TEXT NOT NULL, action TEXT NOT NULL, intent TEXT NOT NULL,
                job_id TEXT, outcome TEXT NOT NULL, request_json TEXT NOT NULL,
                PRIMARY KEY(run_id,invocation_id)
            );
            CREATE INDEX IF NOT EXISTS capability_dispatch_job
                ON capability_dispatches(job_id) WHERE job_id IS NOT NULL;
            UPDATE capability_scopes SET state='interrupted' WHERE state!='closed';
            UPDATE capability_dispatches SET outcome='interrupted' WHERE outcome='reserved';
            INSERT OR IGNORE INTO schema_migrations(version,applied_at)
                VALUES(9,CAST(strftime('%s','now') AS INTEGER));
        """)

    def scope(self, run_id: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT * FROM capability_scopes WHERE run_id=?", (run_id,)
        ).fetchone()
        return dict(row) if row else None

    def create(self, run_id: str, digest: str, snapshot: dict[str, Any]) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO capability_scopes(run_id,digest,state,snapshot) "
                "VALUES(?,?,'pending',?)",
                (run_id, digest, json.dumps(snapshot)),
            )

    def state(self, run_id: str, state: str) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE capability_scopes SET state=? WHERE run_id=?", (state, run_id)
            )

    def dispatch(self, run_id: str, invocation: str) -> dict[str, Any] | None:
        row = self.database.connection.execute(
            "SELECT * FROM capability_dispatches WHERE run_id=? AND invocation_id=?",
            (run_id, invocation),
        ).fetchone()
        return dict(row) if row else None

    def reserve(
        self, run_id: str, invocation: str, action: str, intent: str, request: dict[str, Any]
    ) -> None:
        with self.database.transaction() as connection:
            column, limit = ("model_steps", 48) if action == "inference" else ("media_calls", 4)
            row = connection.execute(
                f"SELECT {column} FROM capability_scopes WHERE run_id=?", (run_id,)
            ).fetchone()
            if not row or row[0] >= limit:
                raise ValueError("TOOL_BUDGET_EXCEEDED")
            connection.execute(
                f"UPDATE capability_scopes SET {column}={column}+1 WHERE run_id=?", (run_id,)
            )
            connection.execute(
                "INSERT INTO capability_dispatches VALUES(?,?,?,?,NULL,'reserved',?)",
                (run_id, invocation, action, intent, json.dumps(request)),
            )

    def bind(self, run_id: str, invocation: str, job_id: str) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE capability_dispatches SET job_id=?,outcome='bound' "
                "WHERE run_id=? AND invocation_id=?",
                (job_id, run_id, invocation),
            )

    def rejected(self, run_id: str, invocation: str) -> None:
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT outcome,action FROM capability_dispatches "
                "WHERE run_id=? AND invocation_id=?",
                (run_id, invocation),
            ).fetchone()
            if row and row[0] == "reserved":
                connection.execute(
                    "UPDATE capability_dispatches SET outcome='rejected' "
                    "WHERE run_id=? AND invocation_id=?",
                    (run_id, invocation),
                )
                if row[1] != "inference":
                    connection.execute(
                        "UPDATE capability_scopes SET media_calls=media_calls-1 WHERE run_id=?",
                        (run_id,),
                    )

    def jobs(self, run_id: str) -> list[str]:
        rows = self.database.connection.execute(
            "SELECT job_id FROM capability_dispatches WHERE run_id=? AND job_id IS NOT NULL",
            (run_id,),
        ).fetchall()
        return [str(row[0]) for row in rows]

    def dispatches(self, run_id: str) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT * FROM capability_dispatches WHERE run_id=?", (run_id,)
        ).fetchall()
        return [dict(row) for row in rows]

    def unbound(self) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT * FROM capability_dispatches WHERE job_id IS NULL "
            "AND outcome IN ('reserved','interrupted')"
        ).fetchall()
        return [dict(row) for row in rows]
