import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Repository } from '../dist/adapters/repository.js'
import { Runs } from '../dist/application/runs.js'
import { evaluateToolPolicy } from '../dist/domain/tool-policy.js'

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await delay(10)
  }
  assert.fail('Expected task state did not arrive')
}
function fixture(t, prompt) {
  const directory = mkdtempSync(join(tmpdir(), 'coding-permissions-'))
  const repo = new Repository(directory),
    commands = []
  repo.save('project', { id: 'p', path: directory, instructions: '', git: false, commands: [] })
  repo.save('session', { id: 's', projectId: 'p', archived: false, piPath: null })
  const runs = new Runs(repo, {
    commands: {
      run: async (command) => {
        commands.push(command)
        return { output: 'ok', exitCode: 0, truncated: false }
      },
      close() {},
    },
    fingerprint: async () => 'current',
    gitStatus: async () => '',
    workspace: () => ({ write: async () => '' }),
    open: async ({ context }) => ({
      path: () => undefined,
      session: {
        prompt: () => prompt(context),
        subscribe() {},
        close: async () => {},
        abort: async () => {},
        steer: async () => {},
        lastStopReason: () => 'stop',
        lastErrorCode: () => undefined,
      },
    }),
  })
  t.after(async () => {
    await runs.close()
    repo.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    repo,
    runs,
    commands,
    submission: {
      sessionId: 's',
      submissionId: 'request',
      text: 'task',
      mode: 'develop',
      provider: { modelId: 'fake' },
    },
  }
}
test('full access executes commands and sensitive writes without pending approvals, keeping authorization records', async (t) => {
  const f = fixture(t, async (context) => {
    await context.authorizeWrite('config', 'package.json', '{}', null)
    await context.command('first', 'pwd')
    await context.command('second', 'node --version')
  })
  const run = await f.runs.submit({ ...f.submission, permissionMode: 'full' })
  await f.runs.wait(run.id)
  assert.equal(f.repo.get('run', run.id).status, 'completed')
  assert.deepEqual(f.commands, ['pwd', 'node --version'])
  assert.equal(f.repo.list('approval').length, 3)
  assert.ok(f.repo.list('approval').every((item) => item.status === 'allowed'))
  assert.ok(!f.repo.events(0, 's').some((event) => event.type === 'approval.requested'))
})
test('live access changes release only the current run approvals and downgrades affect subsequent calls', async (t) => {
  let firstDone = false,
    releaseSecond
  const gate = new Promise((resolve) => {
    releaseSecond = resolve
  })
  const f = fixture(t, async (context) => {
    await context.command('first', 'first')
    firstDone = true
    await gate
    await context.command('second', 'second')
  })
  t.after(() => releaseSecond())
  const run = await f.runs.submit(f.submission)
  await until(() => f.repo.pendingApprovals(run.id).length === 1)
  f.runs.setPermissions(run.id, 'full')
  await until(() => firstDone)
  assert.deepEqual(f.commands, ['first'])
  assert.equal((await f.runs.submit(f.submission)).id, run.id)
  f.runs.setPermissions(run.id, 'ask')
  releaseSecond()
  await until(() => f.repo.pendingApprovals(run.id).length === 1)
  assert.deepEqual(f.commands, ['first'])
  f.runs.setPermissions(run.id, 'full')
  await f.runs.wait(run.id)
  assert.deepEqual(f.commands, ['first', 'second'])
  assert.equal(f.repo.get('run', run.id).initialPermissionMode, 'ask')
  assert.equal((await f.runs.submit(f.submission)).id, run.id)
  assert.throws(() => f.runs.setPermissions(run.id, 'ask'), /RUN_NOT_READY/)
})
test('full access cannot grant writes to read-only modes or ignore capability revocation', async (t) => {
  const f = fixture(t, async () => {})
  await assert.rejects(
    () => f.runs.submit({ ...f.submission, mode: 'analyze', permissionMode: 'full' }),
    /READ_ONLY_MODE/,
  )
  assert.deepEqual(evaluateToolPolicy({ mode: 'review', risk: 'write', permissionMode: 'full' }), {
    decision: 'deny',
    code: 'READ_ONLY_MODE',
  })
  assert.deepEqual(
    evaluateToolPolicy({ mode: 'develop', risk: 'write', permissionMode: 'full', revoked: true }),
    { decision: 'deny', code: 'CAPABILITY_REVOKED' },
  )
})
test('snapshot history retains conversation records through hundreds of cumulative streaming updates', (t) => {
  const f = fixture(t, async () => {})
  f.repo.append('s', 'r', 'run.started', 'original request')
  for (let index = 0; index < 500; index++)
    f.repo.append('s', 'r', 'assistant.delta', `partial ${index}`, { messageId: 'message' })
  const history = f.repo.historyEvents(f.repo.watermark() + 1, 's', 100)
  assert.equal(history[0].text, 'original request')
  assert.equal(history.filter((item) => item.type === 'assistant.delta').length, 1)
  assert.equal(history.at(-1).text, 'partial 499')
})
