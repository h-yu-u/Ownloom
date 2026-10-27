"""Immutable revisions bind each admitted job to its original credential reference."""

import time

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.web import WebConfig


class WebConfigRepository:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def current(self) -> WebConfig | None:
        row = self.database.connection.execute(
            "SELECT id,current_revision FROM web_search_profiles WHERE id='search_default'"
        ).fetchone()
        return self.get(row[0], row[1]) if row else None

    def get(self, config_id: str, revision: int) -> WebConfig:
        row = self.database.connection.execute(
            "SELECT provider,base_url,secret_ref FROM web_search_config_revisions "
            "WHERE profile_id=? AND revision=?",
            (config_id, revision),
        ).fetchone()
        if row is None:
            raise RuntimeFault(RuntimeErrorInfo("WEB_NOT_CONFIGURED", "请先配置联网搜索"))
        return WebConfig(config_id, revision, row[0], row[1], row[2])

    def save(self, expected_revision: int, base_url: str, secret_ref: str | None) -> WebConfig:
        with self.database.transaction() as connection:
            current = self.current()
            if expected_revision != (current.revision if current else 0):
                raise RuntimeFault(
                    RuntimeErrorInfo("WEB_CONFIG_CONFLICT", "搜索设置已变化，请刷新后保存")
                )
            revision = expected_revision + 1
            now = int(time.time())
            connection.execute(
                "INSERT INTO web_search_profiles VALUES('search_default','Tavily',?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET current_revision=excluded.current_revision,"
                "updated_at=excluded.updated_at",
                (revision, now, now),
            )
            connection.execute(
                "INSERT INTO web_search_config_revisions "
                "VALUES('search_default',?,'tavily',?,?,?,?)",
                (revision, base_url, secret_ref, "{}", now),
            )
        return self.get("search_default", revision)

    def bind_job(self, job_id: str, config: WebConfig) -> None:
        self.database.connection.execute(
            "INSERT INTO job_web_config_refs VALUES(?,?,?)", (job_id, config.id, config.revision)
        )

    def tested(self, config_id: str, revision: int) -> bool:
        return bool(
            self.database.connection.execute(
                "SELECT 1 FROM settings WHERE key=? AND value_json='true'",
                (f"web_search_test:{config_id}:{revision}",),
            ).fetchone()
        )

    def mark_tested(self, config_id: str, revision: int) -> None:
        self.get(config_id, revision)
        with self.database.transaction() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO settings VALUES(?,'true',?)",
                (f"web_search_test:{config_id}:{revision}", int(time.time())),
            )
