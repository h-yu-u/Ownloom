import { expect, it, vi } from 'vitest'
import { createEndpoints, decodeGenerationStats } from '@mlx-studio/api-client'

const stats = {
  source: 'mlx-lm',
  generationTokens: 24,
  generationTps: 17.25,
  promptTokens: 100,
  promptTps: 350.5,
  cachedTokens: 80,
  draftMode: 'dflash2',
  prefillTokens: 20,
  prefillMs: 1500.5,
  firstTokenMs: 1620.25,
  durationMs: 3500.7,
}
function endpoints(value: unknown) {
  return createEndpoints({
    get: vi.fn(async () => value),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })
}
const message = (generationStats: unknown) => ({
  id: 'answer',
  role: 'assistant',
  content: 'Readable answer',
  turnId: 'turn',
  attachments: [],
  parameters: {},
  generationStats,
})

it('decodes original native cumulative values, including prompt and cache metadata', async () => {
  const api = endpoints({
    id: 'conversation',
    title: 'Chat',
    modelId: 'model',
    messages: [message(stats)],
  })
  const result = await api.conversations.get('conversation')
  expect(result.messages[0]?.generationStats).toEqual(stats)
  expect(decodeGenerationStats({ ...stats, source: 'mlx-vlm' })?.source).toBe('mlx-vlm')
})

it('preserves real zeros and normalizes missing individual values to null', () => {
  expect(
    decodeGenerationStats({ source: 'mlx-lm', generationTokens: 0, generationTps: 0 }),
  ).toEqual({
    source: 'mlx-lm',
    generationTokens: 0,
    generationTps: 0,
    promptTokens: null,
    promptTps: null,
    cachedTokens: null,
    draftMode: null,
    prefillTokens: null,
    prefillMs: null,
    firstTokenMs: null,
    durationMs: null,
  })
  expect(decodeGenerationStats({ source: 'mlx-vlm', promptTokens: 20 })).toMatchObject({
    generationTokens: null,
    generationTps: null,
    promptTokens: 20,
  })
})

it.each([
  undefined,
  null,
  [],
  'invalid',
  {},
  { source: 'mlx-lm' },
  { ...stats, source: 'fake' },
  { source: 'mlx-lm', generationTps: '17.25', generationTokens: -1 },
])('keeps history readable when optional metrics are invalid or absent: %j', async (invalid) => {
  const api = endpoints({
    id: 'conversation',
    title: 'Chat',
    modelId: 'model',
    messages: [message(invalid)],
  })
  const result = await api.conversations.get('conversation')
  expect(result.messages[0]?.content).toBe('Readable answer')
  expect(result.messages[0]?.generationStats).toBeNull()
})

it.each([
  ['generationTps', '17.25'],
  ['generationTps', Infinity],
  ['generationTps', NaN],
  ['generationTps', -1],
  ['generationTokens', 2.5],
  ['generationTokens', Number.MAX_SAFE_INTEGER + 1],
  ['cachedTokens', -1],
  ['promptTokens', true],
  ['prefillTokens', 1.5],
  ['prefillMs', -1],
  ['firstTokenMs', '100'],
  ['durationMs', Infinity],
  ['draftMode', 'auto'],
])('normalizes an invalid %s field without discarding other native values', (field, value) => {
  expect(decodeGenerationStats({ ...stats, [String(field)]: value })).toEqual({
    ...stats,
    [String(field)]: null,
  })
})

it('decodes historical metrics without inferring missing mode, cache work or timings', () => {
  expect(
    decodeGenerationStats({ source: 'mlx-vlm', promptTokens: 100, cachedTokens: 80 }),
  ).toMatchObject({
    promptTokens: 100,
    cachedTokens: 80,
    draftMode: null,
    prefillTokens: null,
    prefillMs: null,
    firstTokenMs: null,
    durationMs: null,
  })
  expect(decodeGenerationStats({ source: 'mlx-vlm', draftMode: 'mtp' })).toBeNull()
})

it('preserves a measured zero and real timings even when token rates are unavailable', () => {
  expect(
    decodeGenerationStats({
      source: 'mlx-vlm',
      draftMode: 'none',
      prefillTokens: 0,
      firstTokenMs: 42.75,
    }),
  ).toMatchObject({
    draftMode: 'none',
    prefillTokens: 0,
    firstTokenMs: 42.75,
    generationTps: null,
    durationMs: null,
  })
})

it('decodes snapshot metrics without making optional invalid metadata a job failure', async () => {
  const snapshot = {
    id: 'job',
    state: 'running',
    text: 'snapshot text',
    event_sequence: 4,
    instance_id: 'runtime',
    generationStats: stats,
  }
  expect((await endpoints(snapshot).jobs.get('job')).generationStats).toEqual(stats)
  const result = await endpoints({
    ...snapshot,
    generationStats: { ...stats, source: 'fake' },
  }).jobs.get('job')
  expect(result.text).toBe('snapshot text')
  expect(result.generationStats).toBeNull()
})
