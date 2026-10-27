"""Persist automatic titles without replacing explicit user names or list ordering."""

import sqlite3

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase
from mlx_studio_runtime.domain.conversation_title import DEFAULT_CONVERSATION_TITLES, input_title


def assign_input_title(connection: sqlite3.Connection, identifier: str, content: str) -> None:
    title = input_title(content)
    if title:
        connection.execute(
            "UPDATE conversations SET title=?, "
            "parameters_json=json_set(parameters_json,'$.titleSource','input') "
            "WHERE id=? AND title IN (?,?) "
            "AND COALESCE(json_extract(parameters_json,'$.titleSource'),'') "
            "NOT IN ('manual','input')",
            (title, identifier, *DEFAULT_CONVERSATION_TITLES),
        )


def backfill_conversation_titles(database: SQLiteDatabase) -> None:
    with database.transaction() as connection:
        rows = connection.execute(
            "SELECT c.id, (SELECT content FROM messages WHERE conversation_id=c.id "
            "AND role='user' AND trim(content,char(9)||char(10)||char(13)||' ')<>'' "
            "ORDER BY created_at,rowid LIMIT 1) FROM conversations c "
            "WHERE title IN (?,?) "
            "AND COALESCE(json_extract(parameters_json,'$.titleSource'),'') "
            "NOT IN ('manual','input')",
            DEFAULT_CONVERSATION_TITLES,
        ).fetchall()
        for identifier, content in rows:
            if content is not None:
                assign_input_title(connection, identifier, content)
