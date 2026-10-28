import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile, rm, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { Repository } from '../dist/adapters/repository.js'
import { projectWorkspace } from '../dist/adapters/project-workspace.js'
import { ProjectSessions } from '../dist/application/project-sessions.js'
import { CodingService } from '../dist/application/service.js'
import { WorkspaceVersions } from '../dist/adapters/workspace-version.js'

async function fixture(t, versions) {
  const directory = await realpath(await mkdtemp('/tmp/ownloom-workspace-owner-'))
  const root = join(directory, 'project')
  await mkdir(root)
  await writeFile(join(root, 'note.txt'), 'fixture')
  const repo = new Repository(join(directory, 'data'))
  const projects = projectWorkspace(repo, versions)
  t.after(async () => {
    projects.close?.()
    repo.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, root, repo, projects }
}

test("separate workspace owners do not inherit each other's captured version", async (t) => {
  const f = await fixture(t)
  const other = projectWorkspace(f.repo)
  t.after(() => other.close?.())
  const version = await f.projects.fingerprint(f.root)
  assert.equal(await f.projects.version(f.root), version)
  assert.equal(await other.version(f.root), 'partial:unavailable')
})

function observers() {
  const handles = []
  const versions = new WorkspaceVersions((root, changed, failed) => {
    const handle = { root, changed, failed, closes: 0 }
    handles.push(handle)
    return () => {
      handle.closes++
    }
  })
  return { handles, versions }
}

test('project and probe removal close each observer, including when Host shutdown fails', async (t) => {
  const { handles, versions } = observers()
  const f = await fixture(t, versions)
  f.repo.save('project', { id: 'fixture', path: f.root, name: 'fixture', commands: [] })
  const sessions = new ProjectSessions(f.repo, f.projects, () => {})
  await f.projects.fingerprint(f.root)
  await f.projects.fingerprint(f.root)
  assert.equal(handles.length, 1)
  await sessions.handlers['projects.remove']({ id: 'fixture' })
  assert.equal(handles[0].closes, 1)
  const probe = await f.projects.createProbe()
  await f.projects.writeProbe(probe)
  await f.projects.fingerprint(probe)
  await f.projects.removeProbe(probe)
  assert.equal(handles[1].closes, 1)
  await f.projects.fingerprint(f.root)
  const service = new CodingService(
    f.repo,
    {
      close: async () => {
        throw new Error('ISOLATED_SHUTDOWN_FAILURE')
      },
    },
    sessions,
    { handlers: {} },
    {},
  )
  await assert.rejects(service.close(), /ISOLATED_SHUTDOWN_FAILURE/)
  f.projects.close()
  assert.deepEqual(
    handles.map((handle) => handle.closes),
    [1, 1, 1],
  )
})

test('released captures and observer callbacks cannot overwrite a new capture for the same root', async (t) => {
  const { handles, versions } = observers()
  const f = await fixture(t, versions)
  const old = versions.begin(f.root)
  await old.file(join(f.root, 'note.txt'), await lstat(join(f.root, 'note.txt')))
  versions.release(f.root)
  const current = await f.projects.fingerprint(f.root)
  handles[0].changed()
  handles[0].failed()
  assert.match(old.finish('obsolete'), /^partial:released:/)
  assert.equal(await versions.current(f.root), current)
  handles[1].changed()
  assert.equal(await versions.current(f.root), `stale:${current}`)
})

test('removing a project releases its saved version without deleting project files', async (t) => {
  const f = await fixture(t)
  f.repo.save('project', { id: 'fixture', path: f.root, name: 'fixture', commands: [] })
  await f.projects.fingerprint(f.root)
  const sessions = new ProjectSessions(f.repo, f.projects, () => {})
  assert.deepEqual(await sessions.handlers['projects.remove']({ id: 'fixture' }), { removed: true })
  assert.equal(await f.projects.version(f.root), 'partial:unavailable')
  assert.deepEqual(await f.projects.files(f.root), ['note.txt'])
})

test('Host close releases project observers and prevents captures from reopening them', async (t) => {
  const f = await fixture(t)
  await f.projects.fingerprint(f.root)
  const service = new CodingService(
    f.repo,
    { close: async () => {} },
    new ProjectSessions(f.repo, f.projects, () => {}),
    { handlers: {} },
    {},
  )
  await service.close()
  await service.close()
  assert.equal(await f.projects.version(f.root), 'partial:unavailable')
  await assert.rejects(f.projects.fingerprint(f.root), /WORKSPACE_VERSIONS_CLOSED/)
})
