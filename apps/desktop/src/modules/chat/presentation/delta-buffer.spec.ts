import { afterEach, expect, it, vi } from 'vitest'
import { createDeltaBuffer } from './delta-buffer'

afterEach(() => vi.useRealTimers())
it('shows the first text immediately and coalesces bursts without losing or reordering text', () => {
  vi.useFakeTimers()
  const deliver = vi.fn()
  const buffer = createDeltaBuffer(deliver)
  for (let index = 0; index < 1000; index++) buffer.push('job', `${index},`)
  expect(deliver).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(32)
  expect(deliver).toHaveBeenCalledTimes(2)
  expect(deliver.mock.calls.map((call) => call[1]).join('')).toBe(
    Array.from({ length: 1000 }, (_, index) => `${index},`).join(''),
  )
  expect(vi.getTimerCount()).toBe(0)
})
it('flushes the final pending text before completion or leaving the page', () => {
  vi.useFakeTimers()
  const deliver = vi.fn()
  const buffer = createDeltaBuffer(deliver)
  buffer.push('job', 'first')
  buffer.push('job', 'last')
  buffer.flush()
  expect(deliver.mock.calls).toEqual([
    ['job', 'first'],
    ['job', 'last'],
  ])
  vi.runAllTimers()
  expect(deliver).toHaveBeenCalledTimes(2)
})
it('keeps consecutive jobs separate', () => {
  vi.useFakeTimers()
  const deliver = vi.fn()
  const buffer = createDeltaBuffer(deliver)
  buffer.push('a', '1')
  buffer.push('a', '2')
  buffer.push('b', '3')
  buffer.flush()
  expect(deliver.mock.calls).toEqual([
    ['a', '1'],
    ['a', '2'],
    ['b', '3'],
  ])
})
