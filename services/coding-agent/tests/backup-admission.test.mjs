import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Repository } from '../dist/adapters/repository.js'
import { CodingService } from '../dist/application/service.js'
import { ProjectSessions } from '../dist/application/project-sessions.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture(t, backup, projects = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ownloom-backup-admission-'))
  const repo = new Repository(directory)
  t.after(async () => {
    repo.close()
    await rm(directory, { recursive: true, force: true })
  })
  repo.save('project', { id: 'project', path: directory, name: 'fixture', commands: [] })
  const service = new CodingService(
    repo,
    {},
    new ProjectSessions(repo, projects),
    { handlers: {} },
    {},
    undefined,
    undefined,
    undefined,
    backup,
  )
  return { repo, service }
}

test('backup rejects writes that arrive in the same dispatch turn', async (t) => {
  const finish = deferred()
  const { repo, service } = await fixture(t, async () => {
    await finish.promise
    return { directory: '/isolated/export' }
  })
  const exporting = service.dispatch('data.export', {})
  try {
    await assert.rejects(
      service.dispatch('sessions.create', { projectId: 'project', title: 'late' }),
      /BACKUP_IN_PROGRESS/,
    )
    assert.equal(repo.list('session').length, 0)
  } finally {
    finish.resolve()
    await exporting
  }
})

test('backup drains an admitted asynchronous mutation before taking its snapshot', async (t) => {
  const started = deferred(),
    finish = deferred()
  let snapshotStarted = false
  const { repo, service } = await fixture(
    t,
    async () => {
      snapshotStarted = true
      assert.equal(repo.list('project').length, 2)
      return { directory: '/isolated/export' }
    },
    {
      register: async () => {
        started.resolve()
        await finish.promise
        return {
          id: 'second',
          path: '/isolated/second',
          name: 'second',
          commands: [],
          git: false,
          branch: '',
          dirty: '',
          instructions: '',
        }
      },
    },
  )
  const writing = service.dispatch('projects.register', { path: '/isolated/second' })
  await started.promise
  const exporting = service.dispatch('data.export', {})
  const observed = exporting.catch(() => {})
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(snapshotStarted, false)
    await assert.rejects(
      service.dispatch('sessions.create', { projectId: 'project' }),
      /BACKUP_IN_PROGRESS/,
    )
  } finally {
    finish.resolve()
    await writing
    await observed
  }
  await exporting
})

test('failed snapshot releases admission and concurrent exports cannot release each other', async (t) => {
  const started = deferred(),
    finish = deferred()
  const { service } = await fixture(t, async () => {
    started.resolve()
    await finish.promise
    throw new Error('SNAPSHOT_FAILED')
  })
  const exporting = service.dispatch('data.export', {})
  const rejected = assert.rejects(exporting, /SNAPSHOT_FAILED/)
  await started.promise
  try {
    await assert.rejects(service.dispatch('data.export', {}), /BACKUP_IN_PROGRESS/)
    await assert.rejects(
      service.dispatch('sessions.create', { projectId: 'project' }),
      /BACKUP_IN_PROGRESS/,
    )
  } finally {
    finish.resolve()
    await rejected
  }
  assert.equal(
    (await service.dispatch('sessions.create', { projectId: 'project' })).projectId,
    'project',
  )
})
