import type { DatabaseSync } from 'node:sqlite'
import type { Session } from '../domain/types.js'
import { defaultSessionTitles, sessionWithInputTitle } from '../domain/session-title.js'

export function backfillSessionTitles(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    const rows = db
      .prepare(
        `SELECT value, (SELECT ev.text FROM events ev
      LEFT JOIN entities r ON r.kind='run' AND r.id=ev.runId WHERE ev.sessionId=e.id
      AND ev.type='run.started' AND trim(ev.text,char(9)||char(10)||char(13)||' ')<>''
      AND COALESCE(json_extract(r.value,'$.probe'),0)=0
      AND COALESCE(json_extract(r.value,'$.verifyOnly'),0)=0
      ORDER BY ev.seq LIMIT 1) AS text FROM entities e WHERE kind='session'
      AND json_extract(value,'$.title') IN (?,?) AND json_extract(value,'$.titleSource') IS NULL`,
      )
      .all(...defaultSessionTitles)
    const update = db.prepare("UPDATE entities SET value=? WHERE kind='session' AND id=?")
    for (const row of rows) {
      if (typeof row.text !== 'string') continue
      const previous = JSON.parse(String(row.value)) as Session
      const session = sessionWithInputTitle(previous, row.text)
      if (session !== previous) update.run(JSON.stringify(session), session.id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
