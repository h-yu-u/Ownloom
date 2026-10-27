import { describe, expect, it } from 'vitest'
import { initialChatState, reduceChatState } from './chat-state'

describe('reduceChatState', () => {
  it('applies only deltas for the active generation and completes it', () => {
    const started = reduceChatState(initialChatState, {
      type: 'send.started',
      userMessage: { id: 'user-1', role: 'user', content: 'hello' },
      assistantMessage: { id: 'job-1', role: 'assistant', content: '', state: 'streaming' },
    })
    const stale = reduceChatState(started, {
      type: 'generation.delta',
      jobId: 'other',
      text: 'ignore',
    })
    const delta = reduceChatState(stale, {
      type: 'generation.delta',
      jobId: 'job-1',
      text: 'world',
    })
    const complete = reduceChatState(delta, { type: 'generation.completed', jobId: 'job-1' })
    expect(complete.messages[1]?.content).toBe('world')
    expect(complete.messages[1]?.state).toBe('complete')
    expect(complete.activeJobId).toBeNull()
  })

  it('moves cancelled generation to a terminal view state', () => {
    const started = reduceChatState(initialChatState, {
      type: 'send.started',
      userMessage: { id: 'user-1', role: 'user', content: 'hello' },
      assistantMessage: { id: 'job-2', role: 'assistant', content: '', state: 'streaming' },
    })
    const cancelled = reduceChatState(started, { type: 'generation.cancelled', jobId: 'job-2' })
    expect(cancelled.messages[1]?.state).toBe('cancelled')
    expect(cancelled.status).toBe('idle')
  })
})
