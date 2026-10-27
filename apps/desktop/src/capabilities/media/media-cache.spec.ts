import { afterEach, expect, it, vi } from 'vitest'
import { MediaCache } from './media-cache'

afterEach(vi.unstubAllGlobals)
it('retains visible originals, evicts old thumbnails and reloads an evicted entry', async () => {
  let serial = 0
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: () => `blob:${serial++}`, revokeObjectURL: revoke })
  const load = vi.fn(async () => new Blob())
  const cache = new MediaCache(load, () => {}, 2)
  const release = cache.retain('visible')
  const visible = await cache.get('visible')
  await cache.get('old')
  await cache.get('new')
  expect(cache.snapshot().visible).toBe(visible)
  expect(cache.snapshot().old).toBeUndefined()
  expect(await cache.get('old')).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(4)
  release()
  cache.dispose()
  expect(revoke).toHaveBeenCalledWith(visible)
  expect(cache.snapshot()).toEqual({})
})
