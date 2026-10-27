import { modelFixture } from '../../../test-fixtures/runtime'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { RuntimeError } from '@mlx-studio/api-client'
import { createCodingController } from './coding-controller'
import type { CodingGateway, CodingSnapshot } from '../application/ports'
const project = {
  id: 'p',
  name: 'project',
  path: '/project',
  git: false,
  branch: '',
  dirty: '',
  instructions: '',
  commands: [],
}
const session = {
  id: 's',
  projectId: 'p',
  title: 'session',
  pinned: false,
  archived: false,
  piPath: null,
}
const run = {
  id: 'r',
  sessionId: 's',
  submissionId: 'request',
  text: 'task',
  modelId: 'fake',
  mode: 'develop' as const,
  status: 'running' as const,
  phase: 'exploring',
  verification: 'not_run' as const,
  error: null,
  createdAt: '',
  baseline: '',
  fingerprint: null,
  maxRepairRounds: 2,
}
function snapshot(id = 's'): CodingSnapshot {
  return {
    session: { ...session, id },
    project,
    runs: [],
    approvals: [],
    verifications: [],
    events: [],
    watermark: 12,
    activeRun: null,
  }
}
function fixture() {
  const gateway: CodingGateway = {
    settings: vi.fn(async () => ({
      id: 'coding' as const,
      defaultModelId: 'fake',
      contextBudget: 32768,
      maxRepairRounds: 2,
    })),
    saveSettings: vi.fn(async (value) => value),
    projects: vi.fn(async () => [project]),
    register: vi.fn(async () => project),
    configure: vi.fn(async () => project),
    removeProject: vi.fn(async () => ({})),
    sessions: vi.fn(async () => [session]),
    create: vi.fn(async () => session),
    update: vi.fn(async () => session),
    remove: vi.fn(async () => ({})),
    snapshot: vi.fn(async (id) => snapshot(id)),
    submit: vi.fn(async () => run),
    cancelActive: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    setPermissions: vi.fn(async (_id, permissionMode) => ({ ...run, permissionMode })),
    steer: vi.fn(async () => ({})),
    resolve: vi.fn(async () => ({})),
    changes: vi.fn(async () => ({ managed: [], workspace: '', diff: '', scope: '' })),
    files: vi.fn(async () => []),
    read: vi.fn(async () => 'content'),
    change: vi.fn(async () => ({
      id: 'c',
      runId: 'r',
      sessionId: 's',
      path: 'a',
      before: null,
      after: '',
      contentLoaded: true,
      restored: false,
      state: 'written' as const,
    })),
    restore: vi.fn(async () => ({})),
    capabilities: vi.fn(async () => []),
    verifyModel: vi.fn(async () => ({
      id: 'fake',
      status: 'verified' as const,
      verifiedAt: '',
      engineVersion: '',
      parserVersion: '',
      modelFingerprint: '',
      detail: '',
    })),
    verify: vi.fn(async () => run),
  }
  const release = vi.fn(),
    observe = vi.fn(() => release)
  const controller = createCodingController({
    gateway,
    models: ref([modelFixture({ id: 'fake' })]),
    refreshModels: vi.fn(async () => {}),
    pickDirectory: vi.fn(async () => null),
    observe,
  })
  return { controller, gateway, release, observe }
}
describe('Coding workspace', () => {
  it('updates the sidebar and current title from the accepted task snapshot', async () => {
    const { controller, gateway } = fixture()
    await controller.loadWorkspace('p', 's')
    vi.mocked(gateway.snapshot).mockResolvedValue({
      ...snapshot(),
      session: { ...session, title: '帮我搭建一个图' },
    })
    await controller.send('帮我搭建一个图书馆系统')
    expect(controller.snapshot.value?.session.title).toBe('帮我搭建一个图')
    expect(controller.sessions.value.find((item) => item.id === 's')?.title).toBe('帮我搭建一个图')
    controller.dispose()
  })
  it('keeps access choices scoped to a session and carries them into new tasks', async () => {
    const { controller, gateway } = fixture()
    await controller.loadWorkspace('p', 's')
    await controller.setPermissions('full')
    expect(controller.permissionMode.value).toBe('full')
    await controller.send('task')
    expect(gateway.submit).toHaveBeenCalledWith(
      's',
      expect.objectContaining({ permissionMode: 'full' }),
    )
    await controller.openSession('other')
    expect(controller.permissionMode.value).toBe('ask')
    controller.dispose()
  })
  it('changes the live run policy rather than approving individual commands', async () => {
    const { controller, gateway } = fixture()
    vi.mocked(gateway.snapshot).mockResolvedValue({ ...snapshot(), activeRun: run, runs: [run] })
    await controller.loadWorkspace('p', 's')
    vi.mocked(gateway.snapshot).mockResolvedValue({
      ...snapshot(),
      activeRun: { ...run, permissionMode: 'full' },
      runs: [{ ...run, permissionMode: 'full' }],
    })
    await controller.setPermissions('full')
    expect(gateway.setPermissions).toHaveBeenCalledWith('r', 'full')
    expect(gateway.resolve).not.toHaveBeenCalled()
    expect(controller.permissionMode.value).toBe('full')
    controller.dispose()
  })
  it('prepares an unverified model automatically before the first task', async () => {
    const { controller, gateway } = fixture()
    await controller.loadWorkspace('p', 's')
    expect(await controller.send('task')).toMatchObject({ kind: 'accepted', runId: 'r' })
    expect(gateway.verifyModel).toHaveBeenCalledOnce()
    expect(gateway.submit).toHaveBeenCalledWith(
      's',
      expect.objectContaining({ mode: 'develop', modelId: 'fake', queue: false }),
    )
  })
  it('keeps the task unsent when automatic model preparation fails', async () => {
    const { controller, gateway } = fixture()
    await controller.loadWorkspace('p', 's')
    vi.mocked(gateway.verifyModel).mockResolvedValueOnce({
      id: 'fake',
      status: 'unverified',
      verifiedAt: null,
      engineVersion: '',
      parserVersion: '',
      modelFingerprint: '',
      detail: '模型未能完成工具调用',
    })
    expect(await controller.send('task')).toMatchObject({
      kind: 'failed',
      acceptance: 'not-accepted',
    })
    expect(gateway.submit).not.toHaveBeenCalled()
    expect(controller.preparingModel.value).toBe(false)
    expect(controller.error.value).toContain('模型未能完成工具调用')
  })
  it('prepares an expired model identity and retries the same submission once', async () => {
    const { controller, gateway } = fixture()
    await controller.loadWorkspace('p', 's')
    await controller.verifyModel()
    vi.mocked(gateway.submit).mockRejectedValueOnce(
      new RuntimeError('reverify', 'MODEL_TOOLS_UNVERIFIED'),
    )
    expect(await controller.send('task')).toMatchObject({ kind: 'accepted', runId: 'r' })
    expect(gateway.verifyModel).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(gateway.submit).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(calls[1])
    expect(controller.modelReady.value).toBe(true)
    expect(controller.error.value).toBeNull()
  })
  it('switching sessions and disposing observation never cancels a task', async () => {
    const { controller, gateway, release } = fixture()
    await controller.loadWorkspace('p', 's')
    controller.snapshot.value = { ...snapshot(), activeRun: run }
    await controller.openSession('other')
    controller.dispose()
    expect(release).toHaveBeenCalledTimes(2)
    expect(gateway.cancel).not.toHaveBeenCalled()
  })
  it('keeps queue submission separate from steering and approval', async () => {
    const { controller, gateway } = fixture()
    await controller.loadWorkspace('p', 's')
    await controller.verifyModel()
    controller.snapshot.value = { ...snapshot(), activeRun: run }
    expect(await controller.send('next', true)).toMatchObject({ kind: 'accepted' })
    expect(gateway.submit).toHaveBeenCalledWith(
      's',
      expect.objectContaining({ queue: true, text: 'next' }),
    )
    expect(gateway.steer).not.toHaveBeenCalled()
    controller.snapshot.value = { ...snapshot(), activeRun: run }
    await controller.steer('additional constraint')
    expect(gateway.steer).toHaveBeenCalledWith('r', 'additional constraint')
    await controller.resolve('a', false)
    expect(gateway.resolve).toHaveBeenCalledWith('a', false)
  })
  it('a slow previous-session snapshot cannot replace the selected session', async () => {
    const { controller, gateway } = fixture()
    let finish: ((value: CodingSnapshot) => void) | undefined
    vi.mocked(gateway.snapshot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = controller.openSession('first')
    await controller.openSession('second')
    finish?.(snapshot('first'))
    await first
    expect(controller.snapshot.value?.session.id).toBe('second')
  })
  it('Coding failure stays within its own error state and reconnect can recover', async () => {
    const { controller, gateway } = fixture()
    vi.mocked(gateway.projects).mockRejectedValueOnce(new Error('host unavailable'))
    await controller.loadWorkspace()
    expect(controller.error.value).toBe('host unavailable')
    await controller.loadWorkspace('p', 's')
    expect(controller.error.value).toBeNull()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
describe('Coding request ownership', () => {
  it.each([false, true])(
    'keeps the latest project query when the same project is reopened: %s',
    async (same) => {
      const { controller, gateway } = fixture()
      const first = deferred<(typeof session)[]>()
      vi.mocked(gateway.sessions).mockReturnValueOnce(first.promise)
      const loading = controller.selectProject('p')
      const signal = vi.mocked(gateway.sessions).mock.calls[0]?.[1]
      const target = same ? 'p' : 'other'
      const next = { ...session, id: 'new', projectId: target }
      vi.mocked(gateway.sessions).mockResolvedValueOnce([next])
      await controller.selectProject(target)
      expect(signal?.aborted).toBe(true)
      expect(controller.pending.value).toBe(true)
      first.resolve([session])
      await loading
      expect(controller.projectId.value).toBe(target)
      expect(controller.sessions.value).toEqual([next])
      expect(controller.pending.value).toBe(false)
    },
  )
  it('ignores a project response and error after disposal', async () => {
    const { controller, gateway } = fixture()
    const first = deferred<(typeof session)[]>()
    vi.mocked(gateway.sessions).mockReturnValueOnce(first.promise)
    const loading = controller.selectProject('p')
    controller.dispose()
    first.reject(new Error('late failure'))
    await loading
    expect(controller.sessions.value).toEqual([])
    expect(controller.error.value).toBeNull()
    expect(controller.pending.value).toBe(false)
  })
  it.each(['reopen', 'dispose'])('does not subscribe a stale snapshot after %s', async (action) => {
    const { controller, gateway, observe } = fixture()
    const first = deferred<CodingSnapshot>()
    vi.mocked(gateway.snapshot).mockReturnValueOnce(first.promise)
    const opening = controller.openSession('s')
    if (action === 'reopen') await controller.openSession('s')
    else controller.dispose()
    first.resolve(snapshot())
    await opening
    expect(observe).toHaveBeenCalledTimes(action === 'reopen' ? 1 : 0)
  })
})

it('keeps pending true when an earlier request finishes before the current request', async () => {
  const { controller, gateway } = fixture()
  const first = deferred<(typeof session)[]>(),
    second = deferred<(typeof session)[]>()
  vi.mocked(gateway.sessions).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const a = controller.selectProject('a'),
    b = controller.selectProject('b')
  first.resolve([session])
  await a
  expect(controller.pending.value).toBe(true)
  expect(controller.sessions.value).toEqual([])
  second.resolve([{ ...session, projectId: 'b' }])
  await b
  expect(controller.pending.value).toBe(false)
})
it('cannot reopen a routed session after leaving during project loading', async () => {
  const { controller, gateway, observe } = fixture()
  const first = deferred<(typeof session)[]>()
  vi.mocked(gateway.sessions).mockReturnValueOnce(first.promise)
  const loading = controller.loadWorkspace('p', 's')
  await vi.waitFor(() => expect(gateway.sessions).toHaveBeenCalled())
  controller.dispose()
  first.resolve([session])
  await loading
  expect(controller.sessions.value).toEqual([])
  expect(gateway.snapshot).not.toHaveBeenCalled()
  expect(observe).not.toHaveBeenCalled()
})

it('keeps the oldest page cursor after creating a new session', async () => {
  const { controller, gateway } = fixture()
  const page = Array.from({ length: 100 }, (_, index) => ({ ...session, id: `page-${index}` }))
  vi.mocked(gateway.sessions).mockResolvedValueOnce(page)
  await controller.loadWorkspace('p')
  vi.mocked(gateway.create).mockResolvedValueOnce({ ...session, id: 'new' })
  await controller.newSession()
  vi.mocked(gateway.sessions).mockResolvedValueOnce([{ ...session, id: 'older' }])
  await controller.loadMoreSessions()
  expect(vi.mocked(gateway.sessions).mock.calls.at(-1)?.[2]).toBe('page-99')
  expect(controller.sessions.value[0]?.id).toBe('new')
  expect(controller.sessions.value.at(-1)?.id).toBe('older')
})

it('consumes only the submitted draft and reports acceptance even if the refresh fails', async () => {
  const { controller, gateway } = fixture()
  await controller.loadWorkspace('p', 's')
  controller.draftText.value = 'accepted task'
  vi.mocked(gateway.snapshot).mockRejectedValueOnce(new Error('snapshot offline'))
  expect(await controller.send()).toMatchObject({
    kind: 'accepted',
    syncWarning: expect.stringContaining('同步失败'),
  })
  expect(controller.draftText.value).toBe('')
})
it('does not clear new edits or a different session when an old submission completes', async () => {
  const { controller, gateway } = fixture()
  await controller.loadWorkspace('p', 's')
  controller.draftText.value = 'X'
  const submission = deferred<typeof run>()
  vi.mocked(gateway.submit).mockReturnValueOnce(submission.promise)
  const sending = controller.send()
  await vi.waitFor(() => expect(gateway.submit).toHaveBeenCalled())
  controller.draftText.value = 'Y'
  controller.draftText.value = 'X'
  await controller.openSession('other')
  controller.draftText.value = 'B'
  submission.resolve(run)
  expect((await sending).kind).toBe('accepted')
  expect(controller.draftText.value).toBe('B')
  await controller.openSession('s')
  expect(controller.draftText.value).toBe('X')
})

it('synchronizes an ambiguous steer without replaying it or consuming the draft', async () => {
  const { controller, gateway } = fixture()
  await controller.loadWorkspace('p', 's')
  controller.snapshot.value = { ...snapshot(), activeRun: run }
  controller.draftText.value = 'keep this extra instruction'
  vi.mocked(gateway.steer).mockRejectedValueOnce(new Error('lost response'))
  const reads = vi.mocked(gateway.snapshot).mock.calls.length
  expect(await controller.steer()).toBe(false)
  expect(gateway.steer).toHaveBeenCalledOnce()
  expect(gateway.snapshot).toHaveBeenCalledTimes(reads + 1)
  expect(controller.draftText.value).toBe('keep this extra instruction')
  expect(controller.error.value).toContain('追加结果未知')
})
