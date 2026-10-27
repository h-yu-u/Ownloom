import { migrateCoding } from './coding-migrations.js'
import { backfillSessionTitles } from './session-titles.js'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { Entities, Event, Run, Session } from '../domain/types.js'

// This is the sole writer of Coding metadata. Pi owns the actual model transcript.
export class Repository {
  private db: DatabaseSync
  private writing = false
  private listeners = new Set<() => void>()
  constructor(
    readonly directory: string,
    filename = 'coding.db',
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.directory = realpathSync(directory)
    this.db = new DatabaseSync(join(directory, filename))
    this.db
      .exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS entities (kind TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT, runId TEXT, type TEXT, text TEXT, data TEXT);`)
    migrateCoding(this.db)
    backfillSessionTitles(this.db)
    for (const run of this.byStatus('run', [
      'queued',
      'starting',
      'running',
      'awaiting_approval',
      'cancelling',
    ])) {
      if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
        this.save(
          'run',
          { ...run, status: 'interrupted', error: 'HOST_RESTARTED' },
          'run.interrupted',
          '进程已中断；继续前请重新检查工作区',
        )
      }
    }
    for (const approval of this.byStatus('approval', ['pending'])) {
      if (approval.status === 'pending') this.save('approval', { ...approval, status: 'denied' })
    }
  }
  find<K extends keyof Entities>(kind: K, id: string): Entities[K] | undefined {
    const row = this.db.prepare('SELECT value FROM entities WHERE kind=? AND id=?').get(kind, id)
    return row && typeof row.value === 'string' ? (JSON.parse(row.value) as Entities[K]) : undefined
  }
  get<K extends keyof Entities>(kind: K, id: string): Entities[K] {
    const item = this.find(kind, id)
    if (!item) throw new Error(`${kind.toUpperCase()}_NOT_FOUND`)
    return item
  }
  private scoped<K extends keyof Entities>(
    kind: K,
    field: 'sessionId' | 'projectId' | 'runId' | 'path',
    id: string,
    limit = 100,
    before?: string,
    headers = false,
  ): Entities[K][] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('INVALID_LIMIT')
    const projection = headers
      ? `json_set(json_remove(value,'$.before','$.after'),
      '$.before',CASE WHEN json_type(value,'$.before')='null' THEN NULL ELSE '' END,'$.after','')`
      : 'value'
    return this.db
      .prepare(
        `SELECT ${projection} AS value FROM entities INDEXED BY entities_${field === 'sessionId' ? 'session' : field === 'projectId' ? 'project' : field === 'runId' ? 'run' : 'path'}
      WHERE kind=? AND json_extract(value,'$.${field}')=?
      AND rowid < COALESCE((SELECT rowid FROM entities WHERE kind=? AND id=?),9223372036854775807)
      ORDER BY rowid DESC LIMIT ?`,
      )
      .all(kind, id, kind, before ?? '', limit)
      .map((row) => JSON.parse(String(row.value)) as Entities[K])
  }
  private byStatus<K extends 'run' | 'approval'>(kind: K, statuses: string[]): Entities[K][] {
    return this.db
      .prepare(
        `SELECT value FROM entities INDEXED BY entities_status WHERE kind=?
      AND json_extract(value,'$.status') IN (${statuses.map(() => '?').join(',')}) ORDER BY rowid`,
      )
      .all(kind, ...statuses)
      .map((row) => JSON.parse(String(row.value)) as Entities[K])
  }
  listSessions(projectId: string, before?: string, limit = 100): Entities['session'][] {
    return this.scoped('session', 'projectId', projectId, limit, before)
  }
  listRuns(sessionId: string, before?: string, limit = 50): Run[] {
    return this.scoped('run', 'sessionId', sessionId, limit, before).reverse()
  }
  listApprovals(sessionId: string): Entities['approval'][] {
    return this.scoped('approval', 'sessionId', sessionId, 50).reverse()
  }
  checksForRun(runId: string): Entities['verification'][] {
    return this.scoped('verification', 'runId', runId, 500).reverse()
  }
  listChecks(sessionId: string): Entities['verification'][] {
    return this.scoped('verification', 'sessionId', sessionId, 20).reverse()
  }
  changesForRun(runId: string): Entities['change'][] {
    return this.scoped('change', 'runId', runId, 500).reverse()
  }
  changeHeaders(
    sessionId: string,
    before?: string,
    limit = 100,
  ): (Entities['change'] & { contentLoaded: false })[] {
    return this.scoped('change', 'sessionId', sessionId, limit, before, true)
      .reverse()
      .map((item) => ({
        ...item,
        before: item.before === null ? null : '',
        after: '',
        contentLoaded: false,
      }))
  }
  changeDetail(id: string): Entities['change'] & { contentLoaded: true } {
    const item = this.get('change', id)
    const first = this.db
      .prepare(
        `SELECT value FROM entities INDEXED BY entities_session_path WHERE kind='change'
      AND json_extract(value,'$.sessionId')=? AND json_extract(value,'$.path')=?
      AND json_extract(value,'$.restored')=0 ORDER BY rowid LIMIT 1`,
      )
      .get(item.sessionId, item.path)
    const baseline = first ? (JSON.parse(String(first.value)) as Entities['change']) : item
    return { ...item, before: baseline.before, contentLoaded: true }
  }
  pendingApprovals(runId: string): Entities['approval'][] {
    return this.scoped('approval', 'runId', runId, 500).filter((item) => item.status === 'pending')
  }
  findSubmission(sessionId: string, submissionId: string): Run | undefined {
    const row = this.db
      .prepare(
        `SELECT value FROM entities INDEXED BY entities_submission WHERE kind='run'
      AND json_extract(value,'$.sessionId')=? AND json_extract(value,'$.submissionId')=? LIMIT 1`,
      )
      .get(sessionId, submissionId)
    return row ? (JSON.parse(String(row.value)) as Run) : undefined
  }
  findProject(path: string): Entities['project'] | undefined {
    return this.scoped('project', 'path', path, 1)[0]
  }
  list<K extends keyof Entities>(kind: K): Entities[K][] {
    return this.db
      .prepare('SELECT value FROM entities WHERE kind=? ORDER BY rowid')
      .all(kind)
      .map((row) => JSON.parse(String(row.value)) as Entities[K])
  }
  save<K extends keyof Entities>(
    kind: K,
    item: Entities[K],
    type?: string,
    text = '',
  ): Entities[K] {
    return this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO entities VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value',
        )
        .run(kind, item.id, JSON.stringify(item))
      if (type && 'sessionId' in item)
        this.append(
          item.sessionId,
          'runId' in item ? item.runId : kind === 'run' ? item.id : null,
          type,
          text,
          eventProjection(kind, item),
        )
      return item
    })
  }
  startRun(run: Run, session: Session): Run {
    return this.transaction(() => {
      this.save('session', session)
      return this.save('run', run, 'run.started', run.text)
    })
  }
  private transaction<T>(write: () => T): T {
    if (this.writing) return write()
    this.db.exec('BEGIN IMMEDIATE')
    this.writing = true
    let result: T
    try {
      result = write()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.writing = false
    }
    this.notify()
    return result
  }
  append(
    sessionId: string,
    runId: string | null,
    type: string,
    text: string,
    data: unknown = null,
  ): void {
    this.db
      .prepare('INSERT INTO events(sessionId,runId,type,text,data) VALUES(?,?,?,?,?)')
      .run(sessionId, runId, type, text.slice(0, 65536), JSON.stringify(data))
    if (!this.writing) this.notify()
  }
  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
  waitEvents(after: number): Promise<{ events: Event[]; watermark: number }> {
    const events = this.events(after)
    if (events.length) return Promise.resolve({ events, watermark: this.watermark() })
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        this.listeners.delete(finish)
        resolve({ events: this.events(after), watermark: this.watermark() })
      }
      const timer = setTimeout(finish, 20000)
      this.listeners.add(finish)
    })
  }
  events(after: number, sessionId?: string): Event[] {
    const rows = sessionId
      ? this.db
          .prepare(
            after > 0
              ? 'SELECT * FROM events WHERE sessionId=? AND seq>? ORDER BY seq LIMIT 300'
              : 'SELECT * FROM (SELECT * FROM events WHERE sessionId=? AND seq>? ORDER BY seq DESC LIMIT 300) ORDER BY seq',
          )
          .all(sessionId, after)
      : this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 50').all(after)
    return rows.map((row) => ({
      seq: Number(row.seq),
      sessionId: String(row.sessionId),
      runId: row.runId === null ? null : String(row.runId),
      type: String(row.type),
      text: String(row.text),
      data: JSON.parse(String(row.data)) as unknown,
    }))
  }
  historyEvents(before: number, sessionId: string, limit = 50): Event[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_LIMIT')
    return this.db
      .prepare(
        `SELECT * FROM events WHERE sessionId=? AND seq<?
        AND (type<>'assistant.delta' OR seq=(SELECT MAX(seq) FROM events
          WHERE sessionId=? AND seq<? AND type='assistant.delta')) ORDER BY seq DESC LIMIT ?`,
      )
      .all(sessionId, before, sessionId, before, limit)
      .reverse()
      .map((row) => ({
        seq: Number(row.seq),
        sessionId,
        runId: row.runId === null ? null : String(row.runId),
        type: String(row.type),
        text: String(row.text),
        data: JSON.parse(String(row.data)) as unknown,
      }))
  }
  watermark(): number {
    return Number(
      this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get()?.seq ?? 0,
    )
  }
  delete(kind: keyof Entities, id: string): void {
    this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id)
  }
  deleteSession(id: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const kind of ['run', 'approval', 'change', 'verification'] as const) {
        this.db
          .prepare("DELETE FROM entities WHERE kind=? AND json_extract(value,'$.sessionId')=?")
          .run(kind, id)
      }
      this.db.prepare('DELETE FROM events WHERE sessionId=?').run(id)
      this.delete('session', id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  recentRuns(): Run[] {
    return this.db
      .prepare("SELECT value FROM entities WHERE kind='run' ORDER BY rowid DESC LIMIT 100")
      .all()
      .map((row) => JSON.parse(String(row.value)) as Run)
  }
  active(sessionId?: string): Run | undefined {
    const row = this.db
      .prepare(
        `SELECT value FROM entities INDEXED BY entities_active_session WHERE kind='run'
      AND json_extract(value,'$.status') IN ('queued','starting','running','awaiting_approval','cancelling')
      ${sessionId ? "AND json_extract(value,'$.sessionId')=?" : ''} ORDER BY rowid LIMIT 1`,
      )
      .get(...(sessionId ? [sessionId] : []))
    return row ? (JSON.parse(String(row.value)) as Run) : undefined
  }
  exportDatabase(path: string): void {
    this.db.prepare('VACUUM INTO ?').run(path)
  }
  close(): void {
    this.db.close()
  }
}

function eventProjection<K extends keyof Entities>(kind: K, item: Entities[K]): unknown {
  if (kind === 'run' || kind === 'verification')
    return {
      version: 1,
      kind,
      value: Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'handoff')),
    }
  if (kind === 'approval' && 'status' in item)
    return {
      version: 1,
      kind,
      value: { ...item, parameters: item.status === 'pending' ? item.parameters : {} },
    }
  if (kind === 'change' && 'path' in item && 'state' in item)
    return { version: 1, kind, value: { id: item.id, path: item.path, state: item.state } }
  return { version: 1, kind, value: { id: item.id } }
}
