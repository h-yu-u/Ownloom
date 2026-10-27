import { describe, it, expect, vi, afterEach } from 'vitest'
import type { CodingEvent, RuntimeClient } from '@mlx-studio/api-client'
import { observeCoding } from './coding-observer'
const event = (seq: number): CodingEvent => ({
  seq,
  sessionId: 's',
  runId: null,
  type: 'tool.finished',
  text: 'done',
  data: null,
})
afterEach(() => vi.useRealTimers())
describe('Coding incremental observer', () => {
  it('applies contiguous events without snapshots, recovers gaps, and drops late callbacks', async () => {
    let receive!: (event: CodingEvent) => void
    const subscribeCoding = vi.fn((_callback, signal: AbortSignal) => {
      receive = _callback
      return new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    })
    const connection = { subscribeCoding } as unknown as RuntimeClient
    const refresh = vi.fn().mockResolvedValueOnce(10).mockResolvedValue(14)
    const apply = vi.fn(() => true)
    const stop = observeCoding(async () => connection, 10, refresh, vi.fn(), apply)
    await vi.waitFor(() => expect(subscribeCoding).toHaveBeenCalledOnce())
    receive(event(11))
    receive(event(12))
    expect(apply).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledOnce()
    receive(event(14))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    stop()
    receive(event(15))
    expect(apply).toHaveBeenCalledTimes(2)
  })
})
