import type { DatabaseSync } from 'node:sqlite'

/** Incremental on-disk format. JSON payloads remain compatible with existing histories. */
export function migrateCoding(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (version > 1) throw new Error('CODING_DATABASE_TOO_NEW')
  if (version === 1) return
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE INDEX entities_session ON entities(kind,json_extract(value,'$.sessionId'));
      CREATE INDEX entities_project ON entities(kind,json_extract(value,'$.projectId'));
      CREATE INDEX entities_run ON entities(kind,json_extract(value,'$.runId'));
      CREATE INDEX entities_session_path ON entities(kind,json_extract(value,'$.sessionId'),json_extract(value,'$.path'));
      CREATE INDEX entities_submission ON entities(kind,json_extract(value,'$.sessionId'),json_extract(value,'$.submissionId'));
      CREATE INDEX entities_path ON entities(kind,json_extract(value,'$.path'));
      CREATE INDEX entities_status ON entities(kind,json_extract(value,'$.status'));
      CREATE INDEX entities_active_session ON entities(json_extract(value,'$.sessionId')) WHERE kind='run' AND json_extract(value,'$.status') IN ('queued','starting','running','awaiting_approval','cancelling');
      CREATE INDEX events_session_seq ON events(sessionId,seq);
      PRAGMA user_version=1;
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
