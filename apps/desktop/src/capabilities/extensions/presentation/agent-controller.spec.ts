import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AgentChatSnapshot, CodingRun, AgentChatRequest } from '@mlx-studio/api-client'
import { modelFixture } from '../../../test-fixtures/runtime'
import { createAgentController } from './agent-controller'
import { createAgentDraftMemory } from './agent-draft-memory'
const run: CodingRun = {
  id: 'r',
  sessionId: 'A',
  submissionId: 'submission',
  text: 'task',
  modelId: 'model',
  mode: 'develop',
  status: 'completed',
  phase: 'reviewing',
  verification: 'not_run',
  error: null,
  createdAt: '',
  baseline: '',
  fingerprint: null,
  maxRepairRounds: 2,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve,
  }
}
function fixture(memory = createAgentDraftMemory()) {
  const gateway = {
    sessions: vi.fn(async () => [
      { id: 'A', title: 'A', piPath: null },
      { id: 'B', title: 'B', piPath: null },
    ]),
    create: vi.fn(async () => ({ id: 'created', title: 'new', piPath: null })),
    snapshot: vi.fn(
      async (id: string): Promise<AgentChatSnapshot> => ({
        watermark: 0,
        session: { id, title: id, piPath: null },
        runs: [],
        approvals: [],
        events: [],
      }),
    ),
    submit: vi.fn(async (id: string, request: AgentChatRequest) => ({
      ...run,
      sessionId: id,
      submissionId: request.submissionId,
    })),
    cancel: vi.fn(async () => run),
    resolve: vi.fn(async () => ({})),
  }
  const deps = {
    gateway,
    memory,
    models: ref([modelFixture({ id: 'model' })]),
    refreshModels: async () => {},
    verifyModel: async () => {},
  }
  return {
    gateway,
    memory,
    state: createAgentController(deps),
    reopen: () => createAgentController(deps),
  }
}
afterEach(() => vi.useRealTimers())
describe('Agent process lifetime draft memory', () => {
  it('keeps independent session drafts across controller disposal and re-creation', async () => {
    const f = fixture()
    await f.state.open('A')
    f.state.text.value = 'A draft'
    await f.state.open('B')
    f.state.text.value = 'B draft'
    f.state.dispose()
    const reopened = f.reopen()
    await reopened.load()
    expect(reopened.text.value).toBe('B draft')
    await reopened.open('A')
    expect(reopened.text.value).toBe('A draft')
    reopened.dispose()
  })
  it('consumes the submitted version only, even after switching sessions before acceptance', async () => {
    const f = fixture()
    await f.state.load()
    await f.state.open('A')
    f.state.text.value = 'X'
    const response = deferred<CodingRun>()
    f.gateway.submit.mockReturnValueOnce(response.promise)
    const sending = f.state.send({
      skillIds: [],
      toolIds: ['tool'],
      mediaBindings: { imageReferenceIds: ['reference'] },
    })
    await vi.waitFor(() => expect(f.gateway.submit).toHaveBeenCalled())
    f.state.text.value = 'Y'
    f.state.text.value = 'X'
    await f.state.open('B')
    f.state.text.value = 'B draft'
    response.resolve(run)
    expect((await sending).kind).toBe('accepted')
    expect(f.state.text.value).toBe('B draft')
    await f.state.open('A')
    expect(f.state.text.value).toBe('X')
    f.state.dispose()
  })
  it('does not consume a starting snapshot and recovers the same public POST after closing', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.state.load()
    await f.state.open('A')
    f.state.text.value = 'must survive'
    const selection = {
      skillIds: ['skill'],
      toolIds: ['tool'],
      mediaBindings: { imageReferenceIds: ['original'] },
    }
    f.gateway.submit.mockRejectedValueOnce(new Error('lost response'))
    const outcome = await f.state.send(selection)
    expect(outcome).toMatchObject({ kind: 'failed', acceptance: 'unknown' })
    selection.mediaBindings.imageReferenceIds[0] = 'changed'
    const original = f.gateway.submit.mock.calls[0]
    f.state.dispose()
    const reopened = f.reopen()
    f.gateway.snapshot.mockResolvedValue({
      watermark: 0,
      session: { id: 'A', title: 'A', piPath: null },
      runs: [{ ...run, status: 'starting' }],
      approvals: [],
      events: [],
    })
    await reopened.load()
    expect(reopened.text.value).toBe('must survive')
    expect(reopened.recovery.value).toHaveLength(1)
    await reopened.recover(reopened.recovery.value[0]!.request.submissionId)
    expect(f.gateway.submit.mock.calls[1]).toEqual(original)
    expect(original?.[1]).toMatchObject({
      selection: { mediaBindings: { imageReferenceIds: ['original'] } },
    })
    expect(reopened.text.value).toBe('')
    expect(reopened.recovery.value).toHaveLength(0)
    reopened.dispose()
  })
  it('reports acceptance with a sync warning and never repeats an uncertain session create', async () => {
    const f = fixture()
    await f.state.load()
    await f.state.open('A')
    f.state.text.value = 'task'
    f.gateway.snapshot.mockRejectedValueOnce(new Error('refresh failed'))
    expect(await f.state.send({ skillIds: [], toolIds: [] })).toMatchObject({
      kind: 'accepted',
      syncWarning: expect.any(String),
    })
    expect(f.state.text.value).toBe('')
    f.state.dispose()
    const next = fixture()
    await next.state.load()
    next.state.text.value = 'unbound'
    next.gateway.create.mockRejectedValueOnce(new Error('lost create'))
    await next.state.send({ skillIds: [], toolIds: [] })
    await next.state.send({ skillIds: [], toolIds: [] })
    expect(next.gateway.create).toHaveBeenCalledOnce()
    expect(next.state.text.value).toBe('unbound')
    next.state.dispose()
  })
})

it('requires reviewing sessions before explicitly creating again after an unknown create', async () => {
  const f = fixture()
  await f.state.load()
  f.state.text.value = 'keep unbound input'
  f.gateway.create.mockRejectedValueOnce(new Error('lost create'))
  await f.state.send({ skillIds: [], toolIds: [] })
  expect(f.state.creationUncertain.value).toBe(true)
  await f.state.create()
  expect(f.gateway.create).toHaveBeenCalledOnce()
  await f.state.create()
  expect(f.gateway.create).toHaveBeenCalledTimes(2)
  expect(f.state.text.value).toBe('keep unbound input')
  f.state.dispose()
})
