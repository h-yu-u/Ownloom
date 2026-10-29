import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { chatGenerationFixture, nativeStats } from '../../../test-fixtures/chat-generation'

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

it('replaces cumulative metrics on stats-only frames without adding tokens or changing text', () => {
  vi.useFakeTimers()
  const { state, delta } = setup()
  delta('A', 1, nativeStats(2, 20))
  delta('', 2, nativeStats(3, 15))
  vi.advanceTimersByTime(32)
  expect(state.value.messages[0]?.content).toBe('A')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(3, 15))
  delta('', 2, nativeStats(999, 999))
  delta('B', 3)
  vi.runAllTimers()
  expect(state.value.messages[0]?.content).toBe('AB')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(3, 15))
})

it('preserves actual acceleration and measured latency through final frames and history projection', async () => {
  vi.useFakeTimers()
  const { state, gateway, delta, emit, present } = setup()
  const measured = {
    ...nativeStats(24, 17.25),
    draftMode: 'mtp' as const,
    prefillTokens: 40,
    prefillMs: 250,
    firstTokenMs: 300,
    durationMs: 1500,
  }
  gateway.get.mockRejectedValueOnce(new Error('history unavailable'))
  delta('Answer', 1, nativeStats())
  delta('', 2, measured)
  emit('job.succeeded', {})
  await flushPromises()
  expect(state.value.messages[0]?.generationStats).toEqual(measured)
  present({
    id: 'conversation',
    title: 'Chat',
    modelId: 'model',
    pinned: false,
    messages: [
      {
        id: 'saved',
        turnId: 'turn',
        role: 'assistant',
        content: 'Answer',
        attachments: [],
        parameters: {},
        generationStats: measured,
      },
    ],
  })
  expect(state.value.messages[0]?.generationStats).toEqual(measured)
})

it('ignores metrics and terminal events for another job', () => {
  const { state, emit } = setup()
  emit('generation.delta', {
    job_id: 'other',
    text: 'wrong',
    textRevision: 1,
    generationStats: nativeStats(),
  })
  emit('job.succeeded', { job_id: 'other' })
  expect(state.value.messages[0]?.content).toBe('')
  expect(state.value.messages[0]?.generationStats).toBeUndefined()
  expect(state.value.activeJobId).toBe('job')
})

it('flushes a native final empty frame before completion even when history reload fails', async () => {
  vi.useFakeTimers()
  const { state, gateway, delta, emit } = setup()
  gateway.get.mockRejectedValueOnce(new Error('history unavailable'))
  delta('Answer', 1, nativeStats(2, 20))
  delta('', 2, nativeStats(10, 12))
  expect(state.value.messages[0]?.generationStats?.generationTokens).toBe(2)
  emit('job.succeeded', {})
  expect(state.value.messages[0]?.state).toBe('complete')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(10, 12))
  await flushPromises()
  vi.runAllTimers()
  expect(state.value.messages[0]?.content).toBe('Answer')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(10, 12))
})

it('clears stale partial metrics on an explicit final null without depending on history reload', async () => {
  vi.useFakeTimers()
  const { state, gateway, delta, emit } = setup()
  gateway.get.mockRejectedValueOnce(new Error('offline'))
  delta('Answer', 1, nativeStats())
  delta('', 2, null)
  emit('job.succeeded', {})
  await flushPromises()
  expect(state.value.messages[0]?.content).toBe('Answer')
  expect(state.value.messages[0]?.state).toBe('complete')
  expect(state.value.messages[0]?.generationStats).toBeNull()
})

it('treats invalid live metadata as absent metrics while keeping the generated answer', () => {
  vi.useFakeTimers()
  const { state, delta } = setup()
  delta('A', 1, nativeStats())
  delta('B', 2, { ...nativeStats(), source: 'invalid' })
  vi.runAllTimers()
  expect(state.value.messages[0]?.content).toBe('AB')
  expect(state.value.messages[0]?.generationStats).toBeNull()
  expect(state.value.error).toBeNull()
})

it.each(['job.cancelled', 'job.failed'])(
  'flushes text and clears partial metrics on %s',
  (terminal) => {
    vi.useFakeTimers()
    const { state, delta, emit, release } = setup()
    delta('A', 1, nativeStats(2, 20))
    delta('B', 2, nativeStats(3, 15))
    emit(terminal, {})
    expect(state.value.messages[0]?.content).toBe('AB')
    expect(state.value.messages[0]?.generationStats).toBeNull()
    expect(state.value.activeJobId).toBeNull()
    expect(release).toHaveBeenCalledOnce()
    delta('late', 3, nativeStats(4, 10))
    vi.runAllTimers()
    expect(state.value.messages[0]?.generationStats).toBeNull()
    expect(state.value.messages[0]?.content).toBe('AB')
  },
)

it('replaces transient metrics with the successful durable message and restores them on reopen', async () => {
  const { state, gateway, delta, emit, present } = setup()
  const conversation = {
    id: 'conversation',
    title: 'Chat',
    modelId: 'model',
    pinned: false,
    messages: [
      {
        id: 'saved',
        role: 'assistant' as const,
        content: 'Answer',
        turnId: 'turn',
        attachments: [],
        parameters: {},
        generationStats: nativeStats(10, 12),
      },
    ],
  }
  gateway.get.mockResolvedValueOnce(conversation)
  delta('Answer', 1, nativeStats(2, 20))
  emit('job.succeeded', {})
  await flushPromises()
  expect(state.value.messages[0]?.id).toBe('saved')
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(10, 12))
  present({ ...conversation, activeJobId: 'next-job' })
  expect(state.value.messages[0]?.generationStats).toEqual(nativeStats(10, 12))
  expect(state.value.messages[1]?.generationStats).toBeUndefined()
})
