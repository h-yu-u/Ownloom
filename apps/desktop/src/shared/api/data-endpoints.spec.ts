import { expect, it, vi } from 'vitest'
import { dataEndpoints } from '@mlx-studio/api-client'

it('discards the identified restore preview using the encoded DELETE endpoint', async () => {
  const transport = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(async () => ({ discarded: true })),
  }
  const result = await dataEndpoints(transport).discardPreview('preview/with spaces')
  expect(transport.delete).toHaveBeenCalledExactlyOnceWith(
    '/internal/v1/storage/restore/preview%2Fwith%20spaces',
  )
  expect(transport.post).not.toHaveBeenCalled()
  expect(result).toEqual({ discarded: true })
})
