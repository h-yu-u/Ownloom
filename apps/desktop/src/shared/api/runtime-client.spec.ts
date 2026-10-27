import { RuntimeClient } from '@mlx-studio/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const connection = {
  baseUrl: 'http://127.0.0.1:1234',
  token: 'session-token',
  protocolVersion: 1,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RuntimeClient', () => {
  it('parses CRLF and multiline SSE data frames', async () => {
    const event = { seq: 1, type: 'generation.delta', payload: { text: 'hello' } }
    const json = JSON.stringify(event)
    const split = json.indexOf(',') + 1
    const body =
      `id: 1\r\nevent: generation.delta\r\ndata: ${json.slice(0, split)}\r\n` +
      `data: ${json.slice(split)}\r\n\r\n`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )

    const received: unknown[] = []
    await new RuntimeClient(connection).subscribe(
      (value) => received.push(value),
      new AbortController().signal,
    )

    expect(received).toEqual([event])
  })

  it('invalidates a cached connection after authentication failure', async () => {
    const invalidated = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    const client = new RuntimeClient(connection, { onConnectionInvalid: invalidated })
    await expect(client.get('/internal/v1/runtime/info')).rejects.toThrow('unauthorized')
    expect(invalidated).toHaveBeenCalledOnce()
  })
})
