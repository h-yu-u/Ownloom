"""Scan all historical rows, including artifacts without a surviving job."""

import json
import time
from typing import Any

from mlx_studio_runtime.adapters.persistence.sqlite_database import SQLiteDatabase


def backfill_references(database: SQLiteDatabase) -> None:
    connection = database.connection
    if connection.execute(
        "SELECT 1 FROM settings WHERE key='attachment_reference_backfill_v7'"
    ).fetchone():
        return
    diagnostics: list[dict[str, str]] = []
    with database.transaction():
        for row in connection.execute("SELECT id,kind,request_json FROM jobs").fetchall():
            payload = _payload(row[2], row[0], diagnostics)
            if row[1] == "chat":
                if connection.execute(
                    "SELECT 1 FROM conversations WHERE id=?", (payload.get("conversationId"),)
                ).fetchone():
                    _refs(
                        database,
                        "job",
                        row[0],
                        "submitted",
                        payload.get("attachmentIds", []),
                        diagnostics,
                    )
            elif row[1] == "image":
                _image_refs(database, "job", row[0], payload, diagnostics)
        for row in connection.execute(
            "SELECT id,metadata_json FROM artifacts WHERE kind='image'"
        ).fetchall():
            _image_refs(
                database, "artifact", row[0], _payload(row[1], row[0], diagnostics), diagnostics
            )
        key = "attachment_reference_backfill_diagnostics_v7"
        connection.execute(
            "INSERT OR REPLACE INTO settings VALUES(?,?,?)",
            (key, json.dumps(diagnostics), int(time.time())),
        )
        if not diagnostics:
            connection.execute(
                "INSERT INTO settings VALUES('attachment_reference_backfill_v7','true',?)",
                (int(time.time()),),
            )


def _payload(raw: str, owner: str, diagnostics: list[dict[str, str]]) -> dict[str, Any]:
    try:
        value = json.loads(raw)
        if isinstance(value, dict):
            return value
    except (json.JSONDecodeError, TypeError):
        pass
    diagnostics.append({"owner": owner, "code": "INVALID_REFERENCE_JSON"})
    return {}


def _image_refs(
    database: SQLiteDatabase,
    kind: str,
    owner: str,
    payload: dict[str, Any],
    diagnostics: list[dict[str, str]],
) -> None:
    _refs(database, kind, owner, "image_reference", payload.get("reference_ids", []), diagnostics)
    if payload.get("mask_id"):
        _refs(database, kind, owner, "image_mask", [payload["mask_id"]], diagnostics)


def _refs(
    database: SQLiteDatabase,
    kind: str,
    owner: str,
    usage: str,
    ids: object,
    diagnostics: list[dict[str, str]],
) -> None:
    if not isinstance(ids, list) or any(not isinstance(value, str) for value in ids):
        diagnostics.append({"owner": owner, "code": "INVALID_ATTACHMENT_REFERENCES"})
        return
    for position, attachment_id in enumerate(ids):
        if not database.connection.execute(
            "SELECT 1 FROM attachments WHERE id=?", (attachment_id,)
        ).fetchone():
            diagnostics.append({"owner": owner, "code": "MISSING_ATTACHMENT"})
            continue
        database.connection.execute(
            f"INSERT OR IGNORE INTO {kind}_attachment_refs"
            f"({kind}_id,usage,position,attachment_id) VALUES(?,?,?,?)",
            (owner, usage, position, attachment_id),
        )
