import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Repository } from '../dist/adapters/repository.js'
import { projectWorkspace } from '../dist/adapters/project-workspace.js'
import { Workspace, hash } from '../dist/adapters/workspace.js'
import { Runs } from '../dist/application/runs.js'
import { RunAdmission } from '../dist/application/run-lifecycle.js'
import { ChangeService } from '../dist/application/changes.js'
import { CapabilityVerifier } from '../dist/application/capability-verifier.js'
import { ProjectSessions } from '../dist/application/project-sessions.js'
import { CodingService } from '../dist/application/service.js'

const provider = {
  modelId: 'fake',
  baseUrl: 'http://127.0.0.1:1234/internal/v1/inference',
  token: 'isolated',
  fingerprint: 'fixture',
  engineVersion: 'fixture',
  contextWindow: 32768,
}
const submission = {
  sessionId: 's',
  submissionId: 'fixture',
  text: 'fixture',
  mode: 'develop',
  provider,
}
function gate() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}
async function fixture(t) {
  const directory = await mkdtemp('/tmp/ownloom-fault-effects-'),
    root = join(directory, 'project')
  await mkdir(root)
  await writeFile(join(root, 'note.txt'), 'before')
  const repo = new Repository(join(directory, 'data')),
    projects = projectWorkspace(repo)
  repo.save('project', { id: 'p', path: root, commands: [], git: false })
  repo.save('session', { id: 's', projectId: 'p', archived: false, piPath: null })
  const events = { opens: 0, creates: 0, writes: 0, removes: 0, probes: [] },
    cleanup = []
  const hooks = {
    prompt: async (input) => {
      if (input.project.path === root)
        await input.context.workspace.write('note.txt', 'after', hash('before'))
    },
    close: async () => {
      throw new Error('ISOLATED_CLOSE_FAILURE')
    },
  }
  const ports = {
    commands: { run: async () => ({ exitCode: 0, output: '', truncated: false }), close() {} },
    fingerprint: async () => 'fixture',
    gitStatus: async () => '',
    workspace: (root, run) => new Workspace(repo, root, run),
    open: async (input) => {
      events.opens++
      return {
        path: () => undefined,
        session: {
          prompt: () => hooks.prompt(input),
          subscribe() {},
          close: () => hooks.close(input),
          abort: async () => {},
          steer: async () => {},
          lastStopReason: () => 'stop',
          lastErrorCode: () => undefined,
        },
      }
    },
  }
  const admission = new RunAdmission(),
    runs = new Runs(repo, ports, admission)
  const check = () => admission.check()
  const probes = {
    ...projects,
    createProbe: async () => {
      events.creates++
      const path = await projects.createProbe()
      events.probes.push(path)
      return path
    },
    register: async (path) => ({ id: `probe-${events.creates}`, path, commands: [], git: false }),
    writeProbe: async (path) => {
      events.writes++
      return projects.writeProbe(path)
    },
    removeProbe: async (path) => {
      events.removes++
      return projects.removeProbe(path)
    },
  }
  const sessions = new ProjectSessions(repo, projects, check)
  const changes = new ChangeService(repo, projects, check)
  const verifier = new CapabilityVerifier(repo, runs, probes, check)
  t.after(async () => {
    try {
      for (const action of cleanup) await action()
      await runs.close()
    } finally {
      projects.close()
      repo.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  return {
    root,
    repo,
    projects,
    events,
    hooks,
    cleanup,
    admission,
    runs,
    sessions,
    changes,
    verifier,
  }
}
async function fault(f) {
  const run = await f.runs.submit(submission)
  await f.runs.wait(run.id)
  assert.equal(f.repo.get('run', run.id).error, 'CODING_CLEANUP_FAILED')
  assert.equal(f.runs.busy, true)
  assert.equal(f.repo.active(), undefined)
  return run
}

test('cleanup fault rejects restore before writing a project file', async (t) => {
  const f = await fixture(t),
    run = await fault(f)
  const change = f.repo.changesForRun(run.id)[0]
  await assert.rejects(
    f.changes.handlers['changes.restore']({ id: change.id }),
    /CODING_CLEANUP_FAILED/,
  )
  assert.equal(await readFile(join(f.root, 'note.txt'), 'utf8'), 'after')
  assert.equal(f.repo.get('change', change.id).restored, false)
})

test('cleanup fault rejects verification before creating its probe resources', async (t) => {
  const f = await fixture(t)
  await fault(f)
  await assert.rejects(f.verifier.verify(provider), /CODING_CLEANUP_FAILED/)
  assert.equal(f.events.creates, 0)
  assert.equal(f.events.writes, 0)
  assert.equal(f.events.opens, 1)
})

test('cleanup fault preserves its session and run until the resource owner is closed', async (t) => {
  const f = await fixture(t),
    run = await fault(f)
  await assert.rejects(f.sessions.handlers['sessions.remove']({ id: 's' }), /CODING_CLEANUP_FAILED/)
  assert.equal(f.repo.get('run', run.id).error, 'CODING_CLEANUP_FAILED')
  assert.equal(f.repo.get('session', 's').projectId, 'p')
})

test('a probe whose own cleanup failed keeps its directory and fault records', async (t) => {
  const f = await fixture(t)
  const result = await f.verifier.verify(provider)
  assert.equal(result.status, 'unverified')
  assert.equal(f.runs.busy, true)
  const runs = f.repo.list('run')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].error, 'CODING_CLEANUP_FAILED')
  assert.equal((await stat(f.events.probes[0])).isDirectory(), true)
  assert.equal(f.events.removes, 0)
})

test('a released probe is removed even while a different run owns the queue', async (t) => {
  const f = await fixture(t),
    entered = gate(),
    finishProbe = gate(),
    finishOther = gate()
  f.cleanup.push(() => {
    finishProbe.release()
    finishOther.release()
  })
  f.hooks.close = async () => {}
  f.hooks.prompt = async (input) => {
    if (input.project.path === f.root) await finishOther.promise
    else {
      entered.release()
      await finishProbe.promise
    }
  }
  const verified = f.verifier.verify(provider)
  await entered.promise
  const other = await f.runs.submit({ ...submission, queue: true })
  finishProbe.release()
  await verified
  assert.equal(f.runs.busy, true)
  assert.equal(f.events.removes, 1)
  assert.equal(f.repo.list('run').length, 1)
  assert.equal(f.repo.list('run')[0].id, other.id)
  await assert.rejects(stat(f.events.probes[0]), { code: 'ENOENT' })
})

test('faulted resource ownership blocks export and restore despite the terminal database status', async (t) => {
  const f = await fixture(t)
  await fault(f)
  let exports = 0,
    restores = 0
  const service = new CodingService(
    f.repo,
    f.runs,
    f.sessions,
    f.changes,
    f.verifier,
    undefined,
    undefined,
    undefined,
    async () => {
      exports++
      return { directory: f.root }
    },
    async () => {
      restores++
      return { imported: true }
    },
  )
  await assert.rejects(service.dispatch('data.export', {}), /BACKUP_BUSY/)
  await assert.rejects(
    service.dispatch('data.restore.profile', {
      identifier: '11111111-1111-4111-8111-111111111111',
    }),
    /BACKUP_BUSY/,
  )
  assert.equal(exports, 0)
  assert.equal(restores, 0)
})

test('healthy admission retains the existing per-session deletion rule', async (t) => {
  const f = await fixture(t),
    prompt = gate()
  f.cleanup.push(() => prompt.release())
  f.hooks.close = async () => {}
  f.hooks.prompt = () => prompt.promise
  f.repo.save('session', { id: 'idle', projectId: 'p', archived: false, piPath: null })
  const run = await f.runs.submit(submission)
  assert.equal(f.runs.owns(run.id), true)
  await assert.rejects(f.sessions.handlers['sessions.remove']({ id: 's' }), /SESSION_IN_USE/)
  assert.deepEqual(await f.sessions.handlers['sessions.remove']({ id: 'idle' }), { removed: true })
  assert.equal(f.repo.get('run', run.id).sessionId, 's')
})

test('shared fault guards also apply when Coding itself no longer owns a run', async (t) => {
  const f = await fixture(t)
  f.hooks.close = async () => {}
  const run = await f.runs.submit(submission)
  await f.runs.wait(run.id)
  assert.equal(f.runs.busy, false)
  f.admission.block()
  const change = f.repo.changesForRun(run.id)[0]
  await assert.rejects(
    f.changes.handlers['changes.restore']({ id: change.id }),
    /CODING_CLEANUP_FAILED/,
  )
  await assert.rejects(f.verifier.verify(provider), /CODING_CLEANUP_FAILED/)
  await assert.rejects(f.sessions.handlers['sessions.remove']({ id: 's' }), /CODING_CLEANUP_FAILED/)
  assert.equal(await readFile(join(f.root, 'note.txt'), 'utf8'), 'after')
  assert.equal(f.events.creates, 0)
})
