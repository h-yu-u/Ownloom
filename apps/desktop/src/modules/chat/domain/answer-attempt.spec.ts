import { expect, it } from 'vitest'
import { regenerationMode } from './answer-attempt'
import type { ChatMessage } from './chat-state'

it('refreshes web evidence by default instead of silently reusing stale sources', () => {
  const message: ChatMessage = {
    id: 'answer',
    role: 'assistant',
    content: 'answer',
    parameters: { contextJobId: 'frozen-job' },
    sources: [
      {
        id: 'w1',
        kind: 'web',
        title: 'Source',
        url: 'https://example.com',
        retrievedAt: '2025-07-27',
        representation: 'snippet_only',
        contentHash: '',
      },
    ],
  }
  expect(regenerationMode(message)).toBe('refresh_web')
  expect(regenerationMode({ ...message, sources: [] })).toBe('reuse_context')
  expect(regenerationMode({ ...message, sources: [], parameters: {} })).toBe('local_only')
})
