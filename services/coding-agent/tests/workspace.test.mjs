import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile, readFile, symlink, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository } from '../dist/adapters/repository.js'
import { Workspace, safePath, hash, read, git as workspaceGit } from '../dist/adapters/workspace.js'
import { createCodingService } from '../dist/composition-root.js'
import { Approvals } from '../dist/application/approvals.js'
import { Commands } from '../dist/adapters/commands.js'
const run = {
  id: 'r',
  sessionId: 's',
  submissionId: 'one',
  text: 'task',
  modelId: 'fake',
  mode: 'develop',
  status: 'running',
  phase: 'editing',
  verification: 'not_run',
  error: null,
  createdAt: '',
  baseline: '',
  fingerprint: null,
  maxRepairRounds: 2,
}
async function fixture(action) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mlx-coding-')))
  const repo = new Repository(join(root, 'data'))
  const project = join(root, '中文 project')
  await mkdir(project)
  try {
    await action({ root, project, repo })
  } finally {
    repo.close()
    await rm(root, { recursive: true, force: true })
  }
}
test('managed read/write reject traversal, symlinks, credentials, binary and stale versions', () =>
  fixture(async ({ root, project, repo }) => {
    await writeFile(join(project, '代码.txt'), '用户原有修改\n')
    await writeFile(join(root, 'outside'), 'private')
    await symlink(join(root, 'outside'), join(project, 'link'))
    await symlink(root, join(project, 'linked-directory'))
    await assert.rejects(
      safePath(join(project, 'linked-directory'), 'outside'),
      /WORKSPACE_ROOT_CHANGED/,
    )
    await writeFile(join(project, 'binary'), Buffer.from([0, 1]))
    for (const path of [
      '../outside',
      'link',
      'linked-directory/outside',
      '.env',
      '.ssh/key',
      'node_modules/a',
      '.git/config',
    ])
      await assert.rejects(safePath(project, path, true))
    await assert.rejects(read(project, 'binary'), /BINARY/)
    const workspace = new Workspace(repo, project, run)
    await assert.rejects(workspace.write('代码.txt', 'bad', 'stale'), /VERSION_CONFLICT/)
    const original = await read(project, '代码.txt')
    await workspace.write('代码.txt', '修改后\n', hash(original))
    assert.equal(repo.list('change')[0].before, original)
    assert.equal(repo.list('change')[0].state, 'written')
    await assert.rejects(
      new Workspace(repo, project, { ...run, mode: 'analyze' }).write(
        '代码.txt',
        'bad',
        hash('修改后\n'),
      ),
      /READ_ONLY/,
    )
  }))
test('undo preserves external edits and restart recovers runs/approvals with monotonic seq', () =>
  fixture(async ({ project, repo }) => {
    const service = createCodingService(repo)
    const registered = await service.dispatch('projects.register', { path: project })
    const session = await service.dispatch('sessions.create', { projectId: registered.id })
    repo.save('run', { ...run, sessionId: session.id })
    await writeFile(join(project, 'a.txt'), 'before')
    await new Workspace(repo, project, { ...run, sessionId: session.id }).write(
      'a.txt',
      'after',
      hash('before'),
    )
    const change = repo.list('change')[0]
    repo.save('run', { ...run, sessionId: session.id, status: 'completed' })
    await writeFile(join(project, 'a.txt'), 'manual edit')
    await assert.rejects(service.dispatch('changes.restore', { id: change.id }), /RESTORE_CONFLICT/)
    assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'manual edit')
    await writeFile(join(project, 'a.txt'), 'after')
    await service.dispatch('changes.restore', { id: change.id })
    assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'before')
    assert.equal(repo.get('run', 'r').verification, 'not_run')
    await service.close()
  }))
test('approval expires, is one-time, and abort denies without executing', () =>
  fixture(async ({ repo }) => {
    repo.save('run', run)
    const gate = new Approvals(repo),
      abort = new AbortController()
    const pending = gate.request(
      {
        runId: 'r',
        sessionId: 's',
        toolCallId: 'call',
        action: 'command',
        parameters: { command: 'echo 1' },
        command: 'echo 1',
        cwd: '/tmp',
      },
      abort.signal,
    )
    const approval = repo.list('approval')[0]
    abort.abort()
    assert.equal(await pending, false)
    assert.equal(repo.get('approval', approval.id).status, 'denied')
    assert.throws(() => gate.resolve(approval.id, true), /ALREADY_RESOLVED/)
  }))
test('command environment omits credentials, caps output and kills cancelled process groups', () =>
  fixture(async ({ project }) => {
    const executor = new Commands()
    process.env.MLX_STUDIO_SESSION_TOKEN = 'must-not-leak'
    const result = await executor.run('env', project)
    assert.equal(result.exitCode, 0)
    assert.ok(!result.output.includes('must-not-leak'))
    const output = await executor.run('yes x | head -c 100000', project)
    assert.equal(output.truncated, true)
    const abort = new AbortController(),
      task = executor.run('sleep 30 & wait', project, abort.signal)
    setTimeout(() => abort.abort(), 30)
    const cancelled = await task
    assert.equal(cancelled.exitCode, null)
    executor.close()
    delete process.env.MLX_STUDIO_SESSION_TOKEN
  }))
test('restart marks incomplete runs interrupted and invalidates pending approvals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mlx-recovery-'))
  let repo = new Repository(directory)
  repo.save('run', run, 'run.started')
  repo.save('approval', {
    id: 'a',
    runId: 'r',
    sessionId: 's',
    toolCallId: 'c',
    action: 'command',
    parameters: {},
    command: 'test',
    cwd: directory,
    policyVersion: 1,
    expiresAt: Date.now() + 10000,
    status: 'pending',
  })
  const watermark = repo.watermark()
  repo.close()
  repo = new Repository(directory)
  try {
    assert.equal(repo.get('run', 'r').status, 'interrupted')
    assert.equal(repo.get('approval', 'a').status, 'denied')
    assert.ok(repo.watermark() > watermark)
  } finally {
    repo.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('large managed files stay out of events and list snapshots; contents load explicitly', () =>
  fixture(async ({ project, repo }) => {
    const service = createCodingService(repo)
    const registered = await service.dispatch('projects.register', { path: project })
    const session = await service.dispatch('sessions.create', { projectId: registered.id })
    const active = { ...run, sessionId: session.id }
    repo.save('run', active)
    const content = '文'.repeat(100000)
    await new Workspace(repo, project, active).write('large.txt', content, null)
    repo.save('run', { ...active, status: 'completed' })
    const listing = await service.dispatch('sessions.changes', { id: session.id })
    assert.ok(JSON.stringify(listing).length < 2000)
    assert.ok(JSON.stringify(repo.events(0, session.id)).length < 2000)
    assert.equal(listing.managed[0].contentLoaded, false)
    const full = await service.dispatch('changes.get', { id: listing.managed[0].id })
    assert.equal(full.after, content)
    assert.equal(full.contentLoaded, true)
    await service.close()
  }))

test('managed writes preserve pre-existing staged, unstaged and untracked user files', () =>
  fixture(async ({ project, repo }) => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)
    const git = (...args) => exec('/usr/bin/git', args, { cwd: project })
    await git('init', '-q')
    await writeFile(join(project, 'staged.txt'), 'index content\n')
    await git('add', 'staged.txt')
    await writeFile(join(project, 'staged.txt'), 'user working tree\n')
    await writeFile(join(project, 'untracked.txt'), 'user untracked\n')
    const baseline = (await git('status', '--porcelain=v1')).stdout
    assert.ok(baseline.includes('AM staged.txt'))
    const diff = await workspaceGit(project, 'diff')
    assert.ok(diff.includes('+user working tree'))
    assert.ok(!diff.includes('+index content'))
    assert.ok(!diff.includes('fatal:'))
    await new Workspace(repo, project, run).write('agent.txt', 'managed\n', null)
    assert.equal((await git('show', ':staged.txt')).stdout, 'index content\n')
    assert.equal(await read(project, 'staged.txt'), 'user working tree\n')
    assert.equal(await read(project, 'untracked.txt'), 'user untracked\n')
    const after = (await git('status', '--porcelain=v1')).stdout
    assert.equal(after.replace('?? agent.txt\n', ''), baseline)
  }))
