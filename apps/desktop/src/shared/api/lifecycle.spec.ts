import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RuntimeClient,
  RuntimeSession,
  RuntimeError,
  createEndpoints,
} from '@mlx-studio/api-client'
import { MediaCache } from '../../capabilities/media/media-cache'

const connection = { baseUrl: 'http://127.0.0.1:1234', token: 'test', protocolVersion: 1 }
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtime resource ownership', () => {
  it('does not invalidate a connection when its request is deliberately aborted', async () => {
    const invalidated = vi.fn()
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    await expect(
      new RuntimeClient(connection, { onConnectionInvalid: invalidated }).get(
        '/test',
        controller.signal,
      ),
    ).rejects.toThrow('aborted')
    expect(invalidated).not.toHaveBeenCalled()
  })
  it('rejects a stale connection result after invalidation', async () => {
    let finish: (value: typeof connection) => void = () => undefined
    const connect = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue({ ...connection, generation: 2 })
    const session = new RuntimeSession(connect, vi.fn())
    const old = session.get()
    session.invalidate('restart', 'starting')
    const current = await session.get()
    finish(connection)
    await expect(old).rejects.toThrow('替换')
    expect(await session.get()).toBe(current)
    expect(session.connection?.generation).toBe(2)
  })
  it('ignores failure callbacks from an old client after a replacement connects', async () => {
    let rejectOld: (cause: Error) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject
          }),
      ),
    )
    const session = new RuntimeSession(async () => connection, vi.fn())
    const old = await session.get()
    const request = old.get('/test')
    session.invalidate('restart', 'starting')
    const current = await session.get()
    rejectOld(new Error('offline'))
    await expect(request).rejects.toThrow('offline')
    expect(await session.get()).toBe(current)
  })
  it('preserves error codes and request IDs and rejects malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: 'MODEL_IN_USE',
                message: 'busy',
                retryable: true,
                request_id: 'request',
              },
            }),
            { status: 409 },
          ),
        )
        .mockResolvedValueOnce(new Response('[{}]')),
    )
    const client = new RuntimeClient(connection)
    await expect(client.get('/test')).rejects.toMatchObject({
      code: 'MODEL_IN_USE',
      requestId: 'request',
      status: 409,
    })
    await expect(createEndpoints(client).models.list()).rejects.toBeInstanceOf(RuntimeError)
  })
  it('does not create an Object URL after its owner has disposed', async () => {
    let finish: (blob: Blob) => void = () => undefined
    const create = vi.fn(() => 'blob:test')
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
    const cache = new MediaCache(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      vi.fn(),
    )
    const request = cache.get('image')
    cache.dispose()
    finish(new Blob(['image']))
    expect(await request).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
    expect(cache.snapshot()).toEqual({})
  })
  it('evicts and revokes older URLs at the configured capacity', async () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValueOnce('blob:a').mockReturnValueOnce('blob:b'),
      revokeObjectURL: revoke,
    })
    const cache = new MediaCache(async () => new Blob(), vi.fn(), 1)
    await cache.get('a')
    await cache.get('b')
    expect(cache.snapshot()).toEqual({ b: 'blob:b' })
    expect(revoke).toHaveBeenCalledWith('blob:a')
    cache.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:b')
  })
})
