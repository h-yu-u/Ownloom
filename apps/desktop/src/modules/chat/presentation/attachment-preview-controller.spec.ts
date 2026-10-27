import { afterEach, expect, it, vi } from 'vitest'
import { MediaCache } from '../../../capabilities/media'
import { createAttachmentPreviewController } from './attachment-preview-controller'
import type { AttachmentGateway } from '../application/attachment-ports'

afterEach(() => vi.unstubAllGlobals())
function setup() {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:managed'), revokeObjectURL: vi.fn() })
  const gateway: AttachmentGateway = {
    upload: vi.fn(),
    metadata: vi.fn(),
    retry: vi.fn(),
    lease: vi.fn(),
    close: vi.fn(),
    original: vi.fn(),
    thumbnail: vi.fn(),
    text: vi.fn(),
  }
  return { gateway, preview: createAttachmentPreviewController(gateway) }
}
it('late text results cannot overwrite a different preview or revive disposed resources', async () => {
  const { gateway, preview } = setup()
  let finish: ((value: Awaited<ReturnType<AttachmentGateway['text']>>) => void) | undefined
  vi.mocked(gateway.text).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = preview.open({
    id: 'A',
    preparationId: 'prep',
    kind: 'document',
    originalName: 'A.txt',
  })
  preview.dispose()
  finish!({
    preparationId: 'prep',
    blocks: [{ id: 'b', text: 'Late content' }],
    totalBlocks: 1,
    coverage: { complete: true },
    warnings: [],
  })
  await pending
  expect(preview.state.target).toBeNull()
  expect(preview.state.text).toBeNull()
})
it('draft eviction does not revoke an independently owned history URL', async () => {
  const { gateway, preview } = setup()
  vi.mocked(gateway.original).mockResolvedValue(new Blob(['image']))
  await preview.open(
    { id: 'A', preparationId: 'prep', kind: 'image', originalName: 'A.png' },
    'history',
  )
  preview.evict('A')
  expect(preview.state.url).toBe('blob:managed')
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  preview.dispose()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
})
it('evicting a pending key prevents it from reappearing in the cache', async () => {
  setup()
  let finish: ((value: Blob) => void) | undefined
  const cache = new MediaCache(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    vi.fn(),
  )
  const request = cache.get('A')
  cache.evict('A')
  finish!(new Blob(['late']))
  expect(await request).toBeUndefined()
  expect(cache.snapshot()).toEqual({})
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  cache.dispose()
})
