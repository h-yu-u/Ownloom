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

const documentTarget = {
  id: 'document',
  preparationId: 'prep',
  kind: 'document' as const,
  originalName: 'notes.txt',
}
function page(id: string) {
  return {
    preparationId: 'prep',
    blocks: [{ id, text: id }],
    totalBlocks: 2,
    coverage: { complete: true },
    warnings: [],
  }
}
it('clears a paging error only when the retry succeeds and preserves loaded blocks', async () => {
  const { gateway, preview } = setup()
  vi.mocked(gateway.text).mockResolvedValueOnce(page('first'))
  await preview.open(documentTarget)
  vi.mocked(gateway.text).mockRejectedValueOnce(new Error('temporarily unavailable'))
  await preview.more()
  expect(preview.state.error).toBe('temporarily unavailable')
  expect(preview.state.text?.blocks).toEqual(page('first').blocks)
  let finish!: (value: ReturnType<typeof page>) => void
  vi.mocked(gateway.text).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  const retry = preview.more()
  expect(preview.state.error).toBe('temporarily unavailable')
  expect(preview.state.loading).toBe(true)
  finish(page('second'))
  await retry
  expect(preview.state.error).toBe('')
  expect(preview.state.text?.blocks.map((block) => block.id)).toEqual(['first', 'second'])
  expect(gateway.text).toHaveBeenLastCalledWith('document', 'prep', 1, expect.any(AbortSignal))
  expect(preview.state.loading).toBe(false)
  preview.dispose()
})
it('preserves a new failure when retrying pagination also fails', async () => {
  const { gateway, preview } = setup()
  vi.mocked(gateway.text).mockResolvedValueOnce(page('first'))
  await preview.open(documentTarget)
  vi.mocked(gateway.text).mockRejectedValueOnce(new Error('first failure'))
  await preview.more()
  vi.mocked(gateway.text).mockRejectedValueOnce(new Error('retry failure'))
  await preview.more()
  expect(preview.state.error).toBe('retry failure')
  expect(preview.state.text?.blocks).toEqual(page('first').blocks)
  expect(preview.state.loading).toBe(false)
  preview.dispose()
})
it('does not clear the new preview error when an old paging retry succeeds late', async () => {
  const { gateway, preview } = setup()
  vi.mocked(gateway.text).mockResolvedValueOnce(page('first'))
  await preview.open(documentTarget)
  let finish!: (value: ReturnType<typeof page>) => void
  vi.mocked(gateway.text).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  const old = preview.more()
  vi.mocked(gateway.text).mockRejectedValueOnce(new Error('new preview failed'))
  await preview.open({ ...documentTarget, id: 'other' })
  finish(page('second'))
  await old
  expect(preview.state.target?.id).toBe('other')
  expect(preview.state.error).toBe('new preview failed')
  expect(preview.state.text).toBeNull()
  preview.dispose()
})
