"""Model manifest persistence."""

import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class ModelRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def list(self) -> list[dict[str, Any]]:
        rows = self.database.connection.execute(
            "SELECT manifest_json,state FROM models ORDER BY created_at"
        ).fetchall()
        return [{**json.loads(row[0]), "state": row[1]} for row in rows]

    def upsert(self, manifest: dict[str, Any], state: str = "available") -> None:
        now = int(time.time())
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO models(id,manifest_json,state,created_at,updated_at) "
                "VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "manifest_json=excluded.manifest_json,state=excluded.state,"
                "updated_at=excluded.updated_at",
                (manifest["id"], json.dumps(manifest), state, now, now),
            )

    def update_state(self, model_id: str, state: str) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE models SET state=?,updated_at=? WHERE id=?",
                (state, int(time.time()), model_id),
            )

    def remove(self, model_id: str) -> bool:
        with self.database.transaction() as connection:
            cursor = connection.execute("DELETE FROM models WHERE id=?", (model_id,))
        return cursor.rowcount > 0
