"""Durable idempotency keys share the chat submission transaction."""

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


class SubmissionJournal:
    def __init__(self, database: SQLiteDatabase) -> None:
        self.database = database

    def find(self, conversation_id: str, request_id: str) -> tuple[str, str, int] | None:
        row = self.database.connection.execute(
            "SELECT digest,job_id,digest_version FROM chat_submissions WHERE "
            "conversation_id=? AND request_id=?",
            (conversation_id, request_id),
        ).fetchone()
        return (str(row[0]), str(row[1]), int(row[2])) if row else None

    def save(self, conversation_id: str, request_id: str, digest: str, job_id: str) -> None:
        self.database.connection.execute(
            "INSERT INTO chat_submissions(conversation_id,request_id,digest,job_id,digest_version) "
            "VALUES(?,?,?,?,2)",
            (conversation_id, request_id, digest, job_id),
        )
