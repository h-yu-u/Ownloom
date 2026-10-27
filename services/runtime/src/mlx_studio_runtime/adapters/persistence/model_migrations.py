"""Remove legacy built-in demo registrations without touching user history or model files."""

import time

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


def migrate_model_catalog(database: SQLiteDatabase) -> None:
    with database.transaction() as connection:
        applied = connection.execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(6,?)",
            (int(time.time()),),
        )
        if applied.rowcount == 0:
            return
        connection.execute(
            "DELETE FROM models WHERE json_extract(manifest_json,'$.engine')='fake' "
            "AND json_extract(manifest_json,'$.source')='builtin'"
        )
