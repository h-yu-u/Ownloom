import { RuntimeClient } from '@mlx-studio/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
const connection = { baseUrl: 'http://127.0.0.1:1234', token: 'local', protocolVersion: 1 }
afterEach(() => vi.unstubAllGlobals())
describe('Coding SSE transport', () => {
  it('preserves Unicode across byte splits and sends its independent replay cursor', async () => {
    const event = {
      seq: 42,
      sessionId: 's',
      runId: 'r',
      type: 'assistant.message',
      text: '中文😀',
      data: null,
    }
    const bytes = new TextEncoder().encode(`id: 42\r\ndata: ${JSON.stringify(event)}\r\n\r\n`)
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1))
              controller.close()
            },
          }),
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    const received: unknown[] = []
    await new RuntimeClient(connection).subscribeCoding(
      (event) => received.push(event),
      new AbortController().signal,
      41,
    )
    expect(received).toEqual([event])
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/internal/v1/coding/events?after_seq=41',
      expect.objectContaining({ headers: { Authorization: 'Bearer local' } }),
    )
  })
})
