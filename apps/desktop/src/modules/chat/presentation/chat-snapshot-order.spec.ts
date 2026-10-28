import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { JobSnapshot, RuntimeEvent } from '@mlx-studio/api-client'
import type { ChatGateway } from '../application/ports'
import type { ChatState } from '../domain/chat-state'
import { createChatStream } from './chat-stream-controller'

function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => (resolve = done)), resolve }
}
const streams: ReturnType<typeof createChatStream>[] = []
afterEach(() => {
  streams.splice(0).forEach((stream) => stream.dispose())
  vi.useRealTimers()
})
function setup() {
  const state = ref<ChatState>({
    activeJobId: 'job',
    status: 'sending',
    error: null,
    messages: [{ id: 'job', role: 'assistant', content: '', state: 'streaming' }],
  })
  const job = vi.fn<ChatGateway['job']>()
  let receive: (event: RuntimeEvent) => void = () => undefined
  const stream = createChatStream({
    state,
    conversationId: ref('conversation'),
    gateway: {
      job,
      list: vi.fn(async () => []),
      upload: vi.fn(),
      sequence: vi.fn(async () => 0),
      submit: vi.fn(),
      get: vi.fn(async () => ({
        id: 'conversation',
        title: 'Conversation',
        modelId: 'model',
        pinned: false,
        messages: [],
      })),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      cancel: vi.fn(),
    },
    present: vi.fn(),
    refresh: vi.fn(),
    observe: (_id, _after, event) => {
      receive = event
      return vi.fn()
    },
  })
  streams.push(stream)
  stream.start('job', 0)
  const delta = (text: string, revision: number) =>
    receive({
      type: 'generation.delta',
      seq: revision,
      payload: { job_id: 'job', text, textRevision: revision },
    })
  return { state, job, stream, delta }
}
const snapshot = (text: string, textRevision: number): JobSnapshot => ({
  id: 'job',
  state: 'running',
  text,
  textRevision,
  projectionVersion: 0,
  event_sequence: textRevision,
  instance_id: 'runtime',
})

it('keeps newer deltas when the first delayed snapshot has an older text revision', async () => {
  const { state, job, stream, delta } = setup()
  const pending = deferred<JobSnapshot>()
  job.mockReturnValueOnce(pending.promise)
  delta('A', 1)
  const reading = stream.reconcile()
  delta('B', 2)
  pending.resolve(snapshot('A', 1))
  await reading
  expect(state.value.messages[0]?.content).toBe('AB')
})

it('settles pending deltas before replacing them with an authoritative snapshot', async () => {
  vi.useFakeTimers()
  const { state, job, stream, delta } = setup()
  const pending = deferred<JobSnapshot>()
  job.mockReturnValueOnce(pending.promise)
  delta('A', 1)
  const reading = stream.reconcile()
  delta('B', 2)
  delta('C', 3)
  pending.resolve(snapshot('ABC', 3))
  await reading
  vi.runAllTimers()
  expect(state.value.messages[0]?.content).toBe('ABC')
})

it('rejects a snapshot belonging to another job', async () => {
  const { state, job, stream, delta } = setup()
  delta('A', 1)
  job.mockResolvedValueOnce({ ...snapshot('other', 5), id: 'another-job' })
  await stream.reconcile()
  expect(state.value.messages[0]?.content).toBe('A')
})

it('accepts a lower revision after an explicit Runtime instance change', async () => {
  const { state, job, stream } = setup()
  job.mockResolvedValueOnce(snapshot('old', 4))
  await stream.reconcile()
  job.mockResolvedValueOnce({ ...snapshot('new', 1), instance_id: 'new-runtime' })
  await stream.reconcile()
  expect(state.value.messages[0]?.content).toBe('new')
})

it('does not overwrite new deltas with a delayed legacy snapshot without revisions', async () => {
  const { state, job, stream, delta } = setup()
  const pending = deferred<JobSnapshot>()
  job.mockReturnValueOnce(pending.promise)
  const reading = stream.reconcile()
  delta('A', 1)
  pending.resolve({ ...snapshot('', 0), textRevision: undefined })
  await reading
  expect(state.value.messages[0]?.content).toBe('A')
})

it('preserves the baseline when an accepted legacy snapshot omits revisions', async () => {
  const { state, job, stream, delta } = setup()
  delta('A', 1)
  job.mockResolvedValueOnce({ ...snapshot('A', 1), textRevision: undefined })
  await stream.reconcile()
  delta('B', 2)
  expect(state.value.messages[0]?.content).toBe('AB')
  expect(job).toHaveBeenCalledOnce()
})

it.each(['succeeded', 'failed', 'cancelled'])(
  'recovers a first %s snapshot when Runtime restarted before a baseline was established',
  async (terminal) => {
    const { state, job, stream, delta } = setup()
    delta('old output', 1)
    job.mockResolvedValueOnce({ ...snapshot('', 0), state: terminal })
    await stream.reconcile()
    expect(state.value.activeJobId).toBeNull()
    expect(state.value.messages[0]?.state).toBe(
      terminal === 'succeeded' ? 'complete' : terminal === 'failed' ? 'error' : 'cancelled',
    )
  },
)

it.each(['succeeded', 'failed', 'cancelled'])(
  'recovers a %s snapshot after same-instance revision state was pruned',
  async (terminal) => {
    const { state, job, stream } = setup()
    job.mockResolvedValueOnce(snapshot('partial', 8))
    await stream.reconcile()
    job.mockResolvedValueOnce({ ...snapshot('durable', 0), state: terminal })
    await stream.reconcile()
    expect(state.value.activeJobId).toBeNull()
    expect(state.value.messages[0]?.content).toBe('durable')
  },
)
