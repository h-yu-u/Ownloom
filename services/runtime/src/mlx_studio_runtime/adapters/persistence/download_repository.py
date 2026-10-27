import json
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class DownloadRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database
        database.connection.execute(
            "CREATE TABLE IF NOT EXISTS downloads (id TEXT PRIMARY KEY,value TEXT NOT NULL)"
        )
        unfinished = database.connection.execute(
            "SELECT value FROM downloads WHERE json_extract(value,'$.state') "
            "IN ('queued','downloading','verifying')"
        ).fetchall()
        for row in unfinished:
            item = json.loads(row[0])
            if item["state"] in {"queued", "downloading", "verifying"}:
                self.save({**item, "state": "paused", "errorCode": "DOWNLOAD_INTERRUPTED"})

    def list(self) -> list[dict[str, Any]]:
        return [
            json.loads(row[0])
            for row in self.database.connection.execute(
                "SELECT value FROM downloads ORDER BY "
                "json_extract(value,'$.state') IN ('queued','downloading','verifying') DESC, "
                "rowid DESC LIMIT 100"
            )
        ]

    def save(self, item: dict[str, Any]) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT INTO downloads VALUES(?,?) ON CONFLICT(id) "
                "DO UPDATE SET value=excluded.value",
                (item["id"], json.dumps(item)),
            )

    def get(self, identifier: str) -> dict[str, Any]:
        row = self.database.connection.execute(
            "SELECT value FROM downloads WHERE id=?", (identifier,)
        ).fetchone()
        if row is None:
            from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

            raise RuntimeFault(RuntimeErrorInfo("DOWNLOAD_NOT_FOUND", "下载任务不存在"))
        return json.loads(row[0])
