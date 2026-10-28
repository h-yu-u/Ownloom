import { afterEach, expect, it, vi } from 'vitest'
import type { JobSnapshot } from '@mlx-studio/api-client'
import {
  chatGenerationFixture,
  deferred,
  jobSnapshot,
  nativeStats,
} from '../../../test-fixtures/chat-generation'
import { projectAttempt } from './chat-projection'

const fixtures: ReturnType<typeof chatGenerationFixture>[] = []
function setup() {
  const fixture = chatGenerationFixture()
  fixtures.push(fixture)
  return fixture
}
afterEach(() => {
  fixtures.splice(0).forEach(({ stream }) => stream.dispose())
  vi.useRealTimers()
})

it('recovers cumulative metrics from a snapshot when a stats-only revision is skipped', async () => {
  const { state, gateway, delta } = setup()
  gateway.job.mockResolvedValueOnce(jobSnapshot('A', 3, nativeStats(6, 15)))
  delta('A', 1, nativeStats(2, 20))
  delta('', 3, nativeStats(6, 15))
  await vi.waitFor(() =>
    expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(6, 15)),
  )
  expect(state.value.messages[0]?.content).toBe('A')
})

it('keeps newer stats-only deltas when the first delayed snapshot has identical text', async () => {
  const { state, gateway, stream, delta } = setup()
  const pending = deferred<JobSnapshot>()
  gateway.job.mockReturnValueOnce(pending.promise)
  delta('A', 1, nativeStats(2, 20))
  const reading = stream.reconcile()
  delta('', 2, nativeStats(4, 15))
  pending.resolve(jobSnapshot('A', 1, nativeStats(2, 20)))
  await reading
  expect(state.value.messages[0]?.content).toBe('A')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(4, 15))
})

it('settles pending stats before applying an authoritative snapshot at the same revision', async () => {
  vi.useFakeTimers()
  const { state, gateway, stream, delta } = setup()
  const pending = deferred<JobSnapshot>()
  gateway.job.mockReturnValueOnce(pending.promise)
  delta('A', 1, nativeStats(2, 20))
  const reading = stream.reconcile()
  delta('B', 2, nativeStats(3, 16))
  delta('', 3, nativeStats(4, 15))
  pending.resolve(jobSnapshot('AB', 3, nativeStats(4, 14)))
  await reading
  vi.runAllTimers()
  expect(state.value.messages[0]?.content).toBe('AB')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(4, 14))
})

it('rejects older snapshots after a baseline and accepts an explicit new Runtime instance', async () => {
  const { state, gateway, stream } = setup()
  gateway.job.mockResolvedValueOnce(jobSnapshot('current', 4, nativeStats(8, 16)))
  await stream.reconcile()
  gateway.job.mockResolvedValueOnce(jobSnapshot('old', 3, nativeStats(6, 20)))
  await stream.reconcile()
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(8, 16))
  gateway.job.mockResolvedValueOnce({
    ...jobSnapshot('restarted', 1, nativeStats(2, 10)),
    instance_id: 'new-runtime',
  })
  await stream.reconcile()
  expect(state.value.messages[0]?.content).toBe('restarted')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(2, 10))
})

it('ignores delayed snapshots and old callbacks after navigating to another conversation', async () => {
  const { state, conversationId, gateway, stream, delta } = setup()
  const pending = deferred<JobSnapshot>()
  gateway.job.mockReturnValueOnce(pending.promise)
  const reading = stream.reconcile()
  stream.dispose()
  conversationId.value = 'other-conversation'
  state.value = {
    activeJobId: null,
    error: null,
    status: 'idle',
    messages: [
      {
        id: 'other-answer',
        role: 'assistant',
        content: 'other',
        state: 'complete',
        generationStats: nativeStats(20, 30),
      },
    ],
  }
  pending.resolve(jobSnapshot('old', 5, nativeStats(10, 10)))
  await reading
  delta('late', 1, nativeStats(2, 2))
  expect(state.value.messages[0]?.content).toBe('other')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(20, 30))
})

it.each(['job.failed', 'job.cancelled'])(
  'keeps the previous successful answer metrics when regeneration ends with %s',
  (terminal) => {
    const { state, delta, emit } = setup()
    state.value = projectAttempt(
      {
        activeJobId: null,
        error: null,
        status: 'idle',
        messages: [
          {
            id: 'saved',
            role: 'assistant',
            content: 'Successful answer',
            state: 'complete',
            generationStats: nativeStats(30, 15),
          },
        ],
      },
      'job',
    )
    expect(state.value.messages[1]?.generationStats).toBeUndefined()
    delta('new partial', 1, nativeStats(2, 100))
    emit(terminal, {})
    expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(30, 15))
    expect(state.value.messages[1]?.generationStats).toBeNull()
  },
)

it('clears transient metrics when the authoritative snapshot has none', async () => {
  const { state, gateway, stream, delta } = setup()
  delta('A', 1, nativeStats())
  gateway.job.mockResolvedValueOnce(jobSnapshot('A', 1))
  await stream.reconcile()
  expect(state.value.messages[0]?.generationStats).toBeNull()
})

it('restores a different active conversation whose job has a lower revision in the same Runtime', async () => {
  const { state, conversationId, gateway, stream, emit } = setup()
  gateway.job.mockResolvedValueOnce(jobSnapshot('old conversation', 20, nativeStats(40, 16)))
  await stream.reconcile()
  stream.dispose()
  conversationId.value = 'next-conversation'
  state.value = {
    activeJobId: 'next-job',
    status: 'sending',
    error: null,
    messages: [{ id: 'next-job', role: 'assistant', content: '', state: 'streaming' }],
  }
  gateway.job.mockResolvedValueOnce({
    ...jobSnapshot('new conversation', 1, nativeStats(2, 10)),
    id: 'next-job',
  })
  await stream.resume()
  expect(state.value.messages[0]?.content).toBe('new conversation')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(2, 10))
  emit('generation.delta', {
    job_id: 'next-job',
    text: '',
    textRevision: 2,
    generationStats: nativeStats(4, 12),
  })
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(4, 12))
})
