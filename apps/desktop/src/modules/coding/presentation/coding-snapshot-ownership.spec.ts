import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createCodingController } from './coding-controller'
import type { CodingControllerDependencies } from './coding-controller-ports'
import type { CodingEvent, CodingGateway, CodingRun, CodingSnapshot } from '../application/ports'

const run: CodingRun = {
  id: 'r',
  sessionId: 's',
  submissionId: 'request',
  text: 'task',
  modelId: 'm',
  mode: 'develop',
  status: 'running',
  phase: 'exploring',
  verification: 'not_run',
  error: null,
  createdAt: '',
  baseline: '',
  fingerprint: null,
  maxRepairRounds: 2,
}
function snapshot(
  watermark = 10,
  status: CodingRun['status'] = 'running',
  id = 's',
): CodingSnapshot {
  const current = { ...run, status, sessionId: id }
  return {
    session: { id, projectId: 'p', title: 'session', pinned: false, archived: false, piPath: null },
    project: {
      id: 'p',
      name: 'project',
      path: '/project',
      git: false,
      branch: '',
      dirty: '',
      instructions: '',
      commands: [],
    },
    runs: [current],
    activeRun: status === 'running' ? current : null,
    approvals: [],
    verifications: [],
    events: [],
    watermark,
  }
}
function event(seq: number, status: CodingRun['status']): CodingEvent {
  return {
    seq,
    sessionId: 's',
    runId: 'r',
    type: 'run.updated',
    text: '',
    data: { version: 1, kind: 'run', value: { ...run, status } },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const controllers: ReturnType<typeof createCodingController>[] = []
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose())
})
function fixture() {
  const gateway: CodingGateway = {
    settings: vi.fn(),
    saveSettings: vi.fn(),
    projects: vi.fn(),
    register: vi.fn(),
    configure: vi.fn(),
    removeProject: vi.fn(),
    sessions: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    submit: vi.fn(),
    cancelActive: vi.fn(),
    cancel: vi.fn(),
    setPermissions: vi.fn(),
    steer: vi.fn(),
    changes: vi.fn(),
    files: vi.fn(),
    read: vi.fn(),
    change: vi.fn(),
    restore: vi.fn(),
    capabilities: vi.fn(),
    verifyModel: vi.fn(),
    verify: vi.fn(),
    snapshot: vi.fn(async () => snapshot()),
    resolve: vi.fn(async () => ({})),
  }
  const observe = vi.fn<CodingControllerDependencies['observe']>(() => vi.fn())
  const controller = createCodingController({
    gateway,
    models: ref([]),
    refreshModels: vi.fn(async () => {}),
    pickDirectory: vi.fn(async () => null),
    observe,
  })
  controllers.push(controller)
  return { controller, gateway, observe }
}

describe('Coding snapshot and event ownership', () => {
  it('does not let a late command refresh replace a committed terminal event', async () => {
    const { controller, gateway, observe } = fixture()
    await controller.openSession('s')
    const late = deferred<CodingSnapshot>()
    vi.mocked(gateway.snapshot).mockReturnValueOnce(late.promise)
    const resolving = controller.resolve('approval', true)
    await vi.waitFor(() => expect(gateway.snapshot).toHaveBeenCalledTimes(2))
    expect(observe.mock.calls[0]?.[3]?.(event(11, 'completed'))).toBe(true)
    expect(controller.busy.value).toBe(false)
    late.resolve(snapshot(10))
    await resolving
    expect(controller.snapshot.value?.watermark).toBe(11)
    expect(controller.snapshot.value?.runs[0]?.status).toBe('completed')
    expect(controller.busy.value).toBe(false)
  })

  it('consumes replayed SSE without regressing a snapshot fetched by a command', async () => {
    const { controller, gateway, observe } = fixture()
    await controller.openSession('s')
    vi.mocked(gateway.snapshot).mockResolvedValueOnce(snapshot(13, 'completed'))
    await controller.resolve('approval', true)
    for (const seq of [11, 12, 13]) {
      expect(observe.mock.calls[0]?.[3]?.(event(seq, 'running'))).toBe(true)
      expect(controller.snapshot.value?.watermark).toBe(13)
      expect(controller.busy.value).toBe(false)
    }
    expect(observe.mock.calls[0]?.[3]?.(event(14, 'running'))).toBe(true)
    expect(controller.snapshot.value?.watermark).toBe(14)
    expect(controller.busy.value).toBe(true)
  })

  it('returns the accepted watermark when concurrent HTTP refreshes finish out of order', async () => {
    const { controller, gateway, observe } = fixture()
    await controller.openSession('s')
    const late = deferred<CodingSnapshot>()
    vi.mocked(gateway.snapshot).mockReturnValueOnce(late.promise)
    const refreshing = observe.mock.calls[0]?.[1]()
    vi.mocked(gateway.snapshot).mockResolvedValueOnce(snapshot(15, 'completed'))
    await controller.resolve('approval', true)
    late.resolve(snapshot(12))
    expect(await refreshing).toBe(15)
    expect(controller.snapshot.value?.watermark).toBe(15)
    expect(controller.busy.value).toBe(false)
  })

  it.each(['s', 'other'])(
    'accepts a fresh baseline for explicitly reopened session %s',
    async (id) => {
      const { controller, gateway, observe } = fixture()
      await controller.openSession('s')
      const late = deferred<CodingSnapshot>()
      vi.mocked(gateway.snapshot).mockReturnValueOnce(late.promise)
      const refreshing = observe.mock.calls[0]?.[1]()
      vi.mocked(gateway.snapshot).mockResolvedValueOnce(snapshot(2, 'completed', id))
      await controller.openSession(id)
      expect(observe.mock.results[0]?.value).toHaveBeenCalledOnce()
      expect(observe.mock.calls[1]?.[0]).toBe(2)
      late.resolve(snapshot(20))
      await refreshing
      expect(observe.mock.calls[0]?.[3]?.(event(21, 'running'))).toBe(false)
      expect(controller.snapshot.value?.session.id).toBe(id)
      expect(controller.snapshot.value?.watermark).toBe(2)
      expect(controller.busy.value).toBe(false)
    },
  )
})
