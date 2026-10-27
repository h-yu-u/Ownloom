import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository } from '../dist/adapters/repository.js'
import { Runs } from '../dist/application/runs.js'
import { buildSnapshot } from '../dist/application/snapshot.js'

for (const verifyOnly of [false, true]) {
  test(`run command evidence is scoped to explicit verification: ${verifyOnly}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'coding-runs-'))
    const repo = new Repository(directory)
    const project = repo.save('project', {
      id: 'p',
      path: directory,
      git: false,
      commands: ['lint', 'test'],
    })
    repo.save('session', { id: 's', projectId: 'p', archived: false, piPath: null })
    const executed = []
    let fingerprint = 'current'
    const runs = new Runs(repo, {
      commands: {
        run: async (command) => {
          executed.push(command)
          repo.save('project', { ...project, commands: ['changed-plan'] })
          return { exitCode: 0, output: 'ok', truncated: false }
        },
        close() {},
      },
      fingerprint: async () => fingerprint,
      gitStatus: async () => '',
      workspace: () => ({ write: async () => '' }),
      open: async ({ context }) => ({
        path: () => undefined,
        session: {
          prompt: async () => {
            await context.invoke('pwd', 'run_command', () => context.command('pwd', 'pwd'))
          },
          subscribe() {},
          close: async () => {},
          abort: async () => {},
          steer: async () => {},
          lastStopReason: () => 'stop',
          lastErrorCode: () => undefined,
        },
      }),
    })
    const timer = setInterval(() => {
      for (const approval of repo.list('approval'))
        if (approval.status === 'pending') runs.resolve(approval.id, true)
    }, 1)
    try {
      const run = await runs.submit({
        sessionId: 's',
        submissionId: 'request',
        text: 'task',
        mode: 'develop',
        provider: { modelId: 'fake' },
        verifyOnly,
      })
      await runs.wait(run.id)
      assert.equal(repo.get('run', run.id).status, 'completed')
      assert.equal(repo.get('run', run.id).verification, verifyOnly ? 'passed' : 'not_run')
      assert.deepEqual(executed, verifyOnly ? ['lint', 'test'] : ['pwd'])
      assert.ok(
        repo
          .list('verification')
          .every((check) => check.purpose === (verifyOnly ? 'verification' : 'command')),
      )
      let snapshot = await buildSnapshot(repo, async () => fingerprint, 's')
      assert.equal(snapshot.runs[0].verification, verifyOnly ? 'passed' : 'not_run')
      fingerprint = 'edited'
      snapshot = await buildSnapshot(repo, async () => fingerprint, 's')
      assert.equal(snapshot.runs[0].verification, verifyOnly ? 'partial' : 'not_run')
      assert.ok(snapshot.verifications.every((check) => check.stale))
    } finally {
      clearInterval(timer)
      await runs.close()
      repo.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
