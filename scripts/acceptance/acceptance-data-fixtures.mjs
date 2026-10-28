import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { command } from './acceptance-system.mjs'

export function dbPath(root) {
  return join(root, 'data/app.db')
}
export function codingPath(root) {
  return join(root, 'data/coding/coding.db')
}

export async function projectFixture(runtime, marker = 'QA_PRIVATE_SOURCE_SENTINEL') {
  const directory = join(runtime.root, 'work', '旧项目 with spaces')
  await mkdir(directory, { recursive: true })
  // Prevent Git discovery from walking into the developer repository above .build/.
  await command('/usr/bin/git', ['-C', directory, 'init', '--quiet'])
  await writeFile(join(directory, 'probe.txt'), 'before\n')
  await writeFile(join(directory, 'private.txt'), marker)
  const project = await runtime.json('/coding/projects', { path: directory })
  const session = await runtime.json(`/coding/projects/${project.id}/sessions`, { title: '旧会话' })
  return { project, session, directory }
}

export function legacyFormat(root, fixture) {
  const db = new DatabaseSync(dbPath(root))
  try {
    const manifest = JSON.parse(
      db.prepare('SELECT manifest_json FROM models LIMIT 1').get().manifest_json,
    )
    manifest.id = 'legacy-builtin-demo'
    manifest.source = 'builtin'
    db.prepare('INSERT INTO models VALUES(?,?,?,?,?)').run(
      manifest.id,
      JSON.stringify(manifest),
      'available',
      1,
      1,
    )
    db.exec(
      'ALTER TABLE messages DROP COLUMN turn_id; DROP TABLE chat_submissions; DELETE FROM schema_migrations WHERE version IN (2,6);',
    )
  } finally {
    db.close()
  }
  const coding = new DatabaseSync(codingPath(root))
  try {
    const indexes = coding
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
      .all()
    for (const { name } of indexes) {
      if (!/^[a-z_]+$/.test(name)) throw new Error('Unexpected fixture index')
      coding.exec('DROP INDEX ' + name)
    }
    const run = {
      id: 'legacy-pending-run',
      sessionId: fixture.session.id,
      submissionId: 'legacy-request',
      text: 'Legacy isolated pending command',
      modelId: 'builtin-fake-text',
      mode: 'develop',
      status: 'awaiting_approval',
      phase: 'executing',
      verification: 'not_run',
      error: null,
      createdAt: new Date().toISOString(),
      baseline: '',
      fingerprint: null,
      maxRepairRounds: 0,
    }
    const approval = {
      id: 'legacy-pending-approval',
      sessionId: fixture.session.id,
      runId: run.id,
      toolCallId: 'legacy-tool',
      action: 'command',
      parameters: {},
      command: '/usr/bin/grep -qx after probe.txt',
      cwd: fixture.directory,
      policyVersion: 1,
      expiresAt: Date.now() + 3600000,
      status: 'pending',
    }
    const insert = coding.prepare('INSERT INTO entities VALUES(?,?,?)')
    insert.run('run', run.id, JSON.stringify(run))
    insert.run('approval', approval.id, JSON.stringify(approval))
    coding.exec('PRAGMA user_version=0')
  } finally {
    coding.close()
  }
}

export function databaseChecks(root) {
  const runtime = new DatabaseSync(dbPath(root), { readOnly: true })
  const coding = new DatabaseSync(codingPath(root), { readOnly: true })
  try {
    return {
      runtimeIntegrity: runtime.prepare('PRAGMA integrity_check').get(),
      foreignKeys: runtime.prepare('PRAGMA foreign_key_check').all(),
      migrations: runtime.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
      codingIntegrity: coding.prepare('PRAGMA integrity_check').get(),
      codingVersion: coding.prepare('PRAGMA user_version').get().user_version,
    }
  } finally {
    runtime.close()
    coding.close()
  }
}

export function seedBulk(root, fixture) {
  const db = new DatabaseSync(codingPath(root))
  const insert = db.prepare('INSERT INTO entities VALUES(?,?,?)')
  const event = db.prepare('INSERT INTO events(sessionId,runId,type,text,data) VALUES(?,?,?,?,?)')
  const save = (kind, item) => insert.run(kind, item.id, JSON.stringify(item))
  db.exec('BEGIN')
  try {
    save('project', { ...fixture.project, id: 'unrelated-project' })
    for (let i = 0; i < 20000; i++)
      save('session', {
        ...fixture.session,
        id: 'bulk-session-' + i,
        projectId: i < 10000 ? fixture.project.id : 'unrelated-project',
      })
    for (let i = 0; i < 20000; i++)
      save('run', {
        id: 'bulk-run-' + i,
        sessionId: i < 1000 ? fixture.session.id : 'bulk-session-10001',
        submissionId: 'bulk-request-' + i,
        text: 'QA historical task '.repeat(8),
        modelId: 'builtin-fake-text',
        mode: 'develop',
        status: 'completed',
        phase: 'completed',
        verification: 'not_run',
        error: null,
        createdAt: new Date(1700000000000 + i).toISOString(),
        baseline: '',
        fingerprint: '',
        maxRepairRounds: 0,
      })
    for (let i = 0; i < 102000; i++)
      event.run(
        i < 2000 ? fixture.session.id : 'bulk-session-10001',
        'bulk-run-' + (i % 1000),
        'assistant.message',
        'QA historical event ' + i,
        '{}',
      )
    const body = 'QA_LARGE_FILE_BODY_MUST_LOAD_ON_DEMAND\n'.repeat(4000)
    for (let i = 0; i < 120; i++)
      save('change', {
        id: 'bulk-change-' + i,
        sessionId: fixture.session.id,
        runId: 'bulk-run-999',
        path: 'generated-' + i + '.txt',
        before: null,
        after: body,
        restored: false,
        state: 'written',
      })
    db.exec('COMMIT')
    return {
      sessions: 20000,
      runs: 20000,
      events: 102000,
      changes: 120,
      changeBytes: Buffer.byteLength(body),
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

export function queryPlans(root, fixture) {
  const db = new DatabaseSync(codingPath(root), { readOnly: true })
  try {
    return {
      sessions: db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT value FROM entities INDEXED BY entities_project WHERE kind='session' AND json_extract(value,'$.projectId')=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(fixture.project.id),
      events: db
        .prepare(
          'EXPLAIN QUERY PLAN SELECT * FROM events WHERE sessionId=? ORDER BY seq DESC LIMIT 300',
        )
        .all(fixture.session.id),
    }
  } finally {
    db.close()
  }
}
