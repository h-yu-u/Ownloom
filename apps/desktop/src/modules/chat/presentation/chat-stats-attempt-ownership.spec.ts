import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import type { Conversation } from '@mlx-studio/api-client'
import {
  chatGenerationFixture,
  deferred,
  nativeStats,
} from '../../../test-fixtures/chat-generation'
import { projectAttempt } from './chat-projection'

const fixtures: ReturnType<typeof chatGenerationFixture>[] = []
afterEach(() => fixtures.splice(0).forEach(({ stream }) => stream.dispose()))

function savedConversation(id: string, count: number): Conversation {
  return {
    id: 'conversation',
    title: 'Chat',
    modelId: 'model',
    pinned: false,
    messages: [
      {
        id,
        role: 'assistant',
        content: id,
        turnId: 'turn',
        attachments: [],
        parameters: {},
        generationStats: nativeStats(count, 12),
      },
    ],
  }
}

it.each(['streaming', 'complete'])(
  'does not let an earlier history reload replace a later %s attempt',
  async (phase) => {
    const fixture = chatGenerationFixture()
    fixtures.push(fixture)
    const { state, gateway, stream, delta, emit } = fixture
    const oldHistory = deferred<Conversation>()
    gateway.get
      .mockReturnValueOnce(oldHistory.promise)
      .mockResolvedValueOnce(savedConversation('new-saved', 20))
    delta('old answer', 1, nativeStats(8, 10))
    emit('job.succeeded', {})
    state.value = projectAttempt(state.value, 'new-job')
    stream.start('new-job', 0)
    emit('generation.delta', {
      job_id: 'new-job',
      text: 'new answer',
      textRevision: 1,
      generationStats: nativeStats(20, 12),
    })
    if (phase === 'complete') {
      emit('job.succeeded', { job_id: 'new-job' })
      await flushPromises()
    }
    oldHistory.resolve(savedConversation('old-saved', 8))
    await flushPromises()
    expect(state.value.messages.at(-1)?.id).toBe(phase === 'complete' ? 'new-saved' : 'new-job')
    expect(state.value.activeJobId).toBe(phase === 'complete' ? null : 'new-job')
    expect(state.value.messages.at(-1)?.generationStats).toEqual(nativeStats(20, 12))
  },
)

it.each(['next-attempt', 'dispose'])(
  'ignores an earlier history failure after %s',
  async (action) => {
    const fixture = chatGenerationFixture()
    fixtures.push(fixture)
    const { state, gateway, stream, delta, emit } = fixture
    const oldHistory = deferred<Conversation>()
    gateway.get.mockReturnValueOnce(oldHistory.promise)
    delta('old answer', 1, nativeStats())
    emit('job.succeeded', {})
    if (action === 'next-attempt') {
      state.value = projectAttempt(state.value, 'new-job')
      stream.start('new-job', 0)
    } else stream.dispose()
    oldHistory.reject(new Error('old history failure'))
    await flushPromises()
    expect(state.value.error).toBeNull()
    expect(state.value.activeJobId).toBe(action === 'next-attempt' ? 'new-job' : null)
  },
)
