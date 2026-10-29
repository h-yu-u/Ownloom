import { expect, it } from 'vitest'
import type { CodingEvent } from '../application/ports'
import { codingGenerationStats } from './coding-generation-stats'
import { timelineEntries } from './coding-activity'

const generationStats = {
  source: 'mlx-vlm',
  generationTokens: 30,
  generationTps: 15.25,
  promptTokens: 1000,
  cachedTokens: 960,
  prefillTokens: 40,
  draftMode: 'dflash2',
  prefillMs: 250,
  firstTokenMs: 300,
  durationMs: 1500,
}
function event(data: unknown, type = 'assistant.message'): CodingEvent {
  return { seq: 1, sessionId: 's', runId: 'r', text: '', type, data }
}

it.each(['stop', 'toolUse'])(
  'projects actual metrics for a successful %s model turn',
  (stopReason) => {
    expect(codingGenerationStats(event({ stopReason, generationStats }))).toMatchObject(
      generationStats,
    )
  },
)

it.each(['error', 'aborted', 'length', undefined])(
  'does not present %s as successful inference',
  (stopReason) => {
    expect(codingGenerationStats(event({ stopReason, generationStats }))).toBeNull()
  },
)

it.each([
  event({ stopReason: 'stop', generationStats }, 'assistant.delta'),
  event({ stopReason: 'stop', generationStats }, 'tool.finished'),
  event({ stopReason: 'stop', generationStats, error: 'INFERENCE_FAILED' }),
  event({ stopReason: 'stop', generationStats: { source: 'fake', generationTokens: 30 } }),
  event({ stopReason: 'stop' }),
])('ignores unavailable or misplaced metadata without inventing a rate', (value) => {
  expect(codingGenerationStats(value)).toBeNull()
})

it('retains a tool-only model turn with real statistics in the timeline', () => {
  const entries = timelineEntries([
    event({ messageId: 'turn', stopReason: 'toolUse', generationStats }),
  ])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ kind: 'message', event: { text: '' }, generationStats })
})

it('keeps successful earlier rounds distinct from a later failed turn', () => {
  const entries = timelineEntries([
    event({ messageId: 'success', stopReason: 'toolUse', generationStats }),
    {
      ...event({
        messageId: 'failed',
        stopReason: 'error',
        error: 'INFERENCE_FAILED',
        generationStats,
      }),
      seq: 2,
    },
  ])
  expect(entries[0]).toMatchObject({ generationStats })
  expect(entries[1]).toMatchObject({ generationStats: null })
})
