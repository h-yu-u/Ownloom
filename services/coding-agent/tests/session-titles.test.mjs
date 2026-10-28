import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Repository } from '../dist/adapters/repository.js'
import { Runs } from '../dist/application/runs.js'
import { ProjectSessions } from '../dist/application/project-sessions.js'
import { sessionWithInputTitle } from '../dist/domain/session-title.js'

const session = {
  id: 's',
  projectId: 'p',
  title: '新开发会话',
  pinned: false,
  archived: false,
  piPath: null,
}
const text = '帮我搭建一个图书馆系统'
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'coding-title-'))
  const repo = new Repository(directory)
  repo.save('project', { id: 'p', path: directory, git: false, commands: [] })
  repo.save('session', session)
  const runs = new Runs(repo, { commands: { close() {} } })
  t.after(async () => {
    await runs.close()
    repo.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const submit = (id, value = text, flags = {}) =>
    runs.submit(
      {
        sessionId: 's',
        submissionId: id,
        text: value,
        mode: 'develop',
        provider: { modelId: 'fake' },
        ...flags,
      },
      true,
    )
  return { directory, repo, runs, submit }
}
test('input titles use seven Unicode characters and keep short and manual names', () => {
  for (const [value, expected] of [
    [text, '帮我搭建一个图'],
    ['  今日\n热点  ', '今日 热点'],
    ['🧑你好世界今天热点', '🧑你好世界今天'],
    ['你好', '你好'],
  ])
    assert.equal(sessionWithInputTitle(session, value).title, expected)
  assert.equal(sessionWithInputTitle(session, '  \n\t'), session)
  assert.equal(sessionWithInputTitle({ ...session, title: '我的计划' }, text).title, '我的计划')
  assert.equal(
    sessionWithInputTitle({ ...session, titleSource: 'manual' }, text).title,
    '新开发会话',
  )
})
test('accepted first input persists its title before execution and retries do not rename it', async (t) => {
  const { repo, submit, runs } = fixture(t)
  const run = await submit('first')
  assert.equal(repo.get('session', 's').title, '帮我搭建一个图')
  await submit('first')
  await runs.cancel(run.id)
  await submit('second', '之后的问题不修改标题')
  assert.equal(repo.get('session', 's').title, '帮我搭建一个图')
})
test('explicit session renames, including placeholders, stay unchanged by later submissions', async (t) => {
  const { repo, submit } = fixture(t)
  const sessions = new ProjectSessions(repo, {}, () => {})
  await sessions.handlers['sessions.update']({ id: 's', title: '新开发会话' })
  await submit('first')
  assert.equal(repo.get('session', 's').title, '新开发会话')
})
test('internal tool probes and verification do not name the user conversation', async (t) => {
  const { repo, submit, runs } = fixture(t)
  for (const flags of [{ probe: true }, { verifyOnly: true }]) {
    const run = await submit(JSON.stringify(flags), '内部检查', flags)
    assert.equal(repo.get('session', 's').title, '新开发会话')
    await runs.cancel(run.id)
  }
  await submit('user')
  assert.equal(repo.get('session', 's').title, '帮我搭建一个图')
})
test('starting a run rolls back its title, run and event together on persistence failure', async (t) => {
  const { directory, repo, submit } = fixture(t)
  const db = new DatabaseSync(join(directory, 'coding.db'))
  t.after(() => db.close())
  db.exec(
    "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected'); END;",
  )
  await assert.rejects(submit('first'), /injected/)
  assert.equal(repo.get('session', 's').title, '新开发会话')
  assert.equal(repo.list('run').length, 0)
  assert.equal(repo.watermark(), 0)
})
test('legacy default titles are backfilled from the earliest request and retained after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coding-legacy-title-'))
  let repo = new Repository(directory)
  try {
    repo.save('session', session)
    repo.save('session', { ...session, id: 'custom', title: '我的计划' })
    repo.save('run', { id: 'probe', sessionId: 's', status: 'completed', probe: true })
    repo.append('s', 'probe', 'run.started', '内部检查不应用于标题')
    repo.append('s', 'r', 'run.started', text)
    repo.append('s', 'r2', 'run.started', '之后的问题不修改标题')
    repo.append('custom', 'r3', 'run.started', text)
    const watermark = repo.watermark()
    repo.close()
    repo = new Repository(directory)
    assert.equal(repo.get('session', 's').title, '帮我搭建一个图')
    assert.equal(repo.get('session', 'custom').title, '我的计划')
    assert.equal(repo.watermark(), watermark)
    repo.close()
    repo = new Repository(directory)
    assert.equal(repo.get('session', 's').title, '帮我搭建一个图')
  } finally {
    repo.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
