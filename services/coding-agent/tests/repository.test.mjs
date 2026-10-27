import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Repository } from '../dist/adapters/repository.js'

for (const failure of ['run', 'approval', 'change', 'verification', 'events', 'session', null]) {
  test(`session deletion is atomic when failure is at ${failure ?? 'none'}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'coding-delete-'))
    const repo = new Repository(directory)
    const db = new DatabaseSync(join(directory, 'coding.db'))
    const kinds = ['run', 'approval', 'change', 'verification', 'session']
    try {
      for (const sessionId of ['s', 'other']) {
        for (const kind of kinds)
          repo.save(kind, {
            id: kind === 'session' ? sessionId : `${sessionId}-${kind}`,
            sessionId,
            status: 'completed',
          })
        repo.append(sessionId, `${sessionId}-run`, 'test', 'saved')
      }
      if (failure === 'events')
        db.exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON events
        WHEN OLD.sessionId='s' BEGIN SELECT RAISE(ABORT, 'injected'); END;`)
      else if (failure)
        db.exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON entities
        WHEN OLD.kind='${failure}' BEGIN SELECT RAISE(ABORT, 'injected'); END;`)
      if (failure) assert.throws(() => repo.deleteSession('s'), /injected/)
      else repo.deleteSession('s')
      for (const kind of kinds) {
        assert.equal(repo.list(kind).length, failure ? 2 : 1)
        assert.ok(repo.list(kind).some((item) => item.sessionId === 'other'))
      }
      assert.equal(repo.events(0, 's').length, failure ? 1 : 0)
      assert.equal(repo.events(0, 'other').length, 1)
    } finally {
      db.close()
      repo.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('migrates an old database once and uses scoped indexes without decoding other sessions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coding-upgrade-'))
  const db = new DatabaseSync(join(directory, 'coding.db'))
  db.exec(`CREATE TABLE entities(kind TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,sessionId TEXT,runId TEXT,type TEXT,text TEXT,data TEXT);`)
  const insert = db.prepare('INSERT INTO entities VALUES(?,?,?)')
  db.exec('BEGIN')
  for (let index = 0; index < 2000; index++)
    insert.run(
      'run',
      `r${index}`,
      JSON.stringify({
        id: `r${index}`,
        sessionId: index < 1900 ? 'old' : 's',
        submissionId: `request${index}`,
        status: 'completed',
      }),
    )
  db.exec('COMMIT')
  let repo
  try {
    repo = new Repository(directory)
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT value FROM entities INDEXED BY entities_session WHERE kind='run' AND json_extract(value,'$.sessionId')='s' ORDER BY rowid DESC LIMIT 50",
      )
      .all()
    assert.ok(
      plan.some((row) => /entities_session|entities_submission/.test(row.detail)),
      JSON.stringify(plan),
    )
    const parse = JSON.parse
    let decoded = 0
    JSON.parse = (...args) => {
      decoded++
      return parse(...args)
    }
    let page
    try {
      page = repo.listRuns('s')
    } finally {
      JSON.parse = parse
    }
    assert.equal(decoded, 50)
    assert.equal(page.length, 50)
    assert.ok(page.every((run) => run.sessionId === 's'))
    assert.equal(repo.findSubmission('s', 'request1999').id, 'r1999')
    assert.equal(repo.findSubmission('old', 'request1999'), undefined)
    const previous = repo.listRuns('s', page[0].id)
    assert.equal(previous.length, 50)
    assert.equal(previous.at(-1).id, 'r1949')
    repo.close()
    repo = new Repository(directory)
    assert.equal(repo.list('run').length, 2000)
  } finally {
    repo?.close()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
test('event waiting replays committed data and never exposes a rolled back event', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'coding-events-'))
  const repo = new Repository(directory)
  const db = new DatabaseSync(join(directory, 'coding.db'))
  try {
    const waiting = repo.waitEvents(0)
    db.exec(
      "CREATE TRIGGER fail_save BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected'); END;",
    )
    assert.throws(
      () => repo.save('run', { id: 'r', sessionId: 's', status: 'running' }, 'run.started'),
      /injected/,
    )
    assert.equal(repo.watermark(), 0)
    db.exec('DROP TRIGGER fail_save')
    repo.append('s', 'r', 'tool.finished', 'done')
    const batch = await waiting
    assert.equal(batch.events.length, 1)
    assert.equal(batch.events[0].type, 'tool.finished')
    assert.deepEqual(await repo.waitEvents(0), batch)
  } finally {
    db.close()
    repo.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
