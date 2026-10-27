import { afterEach, expect, it, vi } from 'vitest'
import type { AttachmentMetadata } from '@mlx-studio/api-client'
import { ChatDrafts } from './chat-drafts'
import { ManageAttachments } from './manage-attachments'
import type { AttachmentGateway } from './attachment-ports'
const managers: ManageAttachments[] = []
afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose()
  vi.useRealTimers()
})

function ready(id: string): AttachmentMetadata {
  return {
    id,
    kind: 'document',
    format: 'txt',
    mimeType: 'text/plain',
    originalName: `${id}.txt`,
    sizeBytes: 1,
    sha256: 'hash',
    processing: {
      preparationId: `prep-${id}`,
      revision: 2,
      state: 'ready',
      coverage: { complete: true },
      warnings: [],
      retryable: false,
    },
  }
}
function setup() {
  const drafts = new ChatDrafts(vi.fn())
  const gateway: AttachmentGateway = {
    upload: vi.fn(),
    metadata: vi.fn(),
    retry: vi.fn(),
    lease: vi.fn(async () => undefined),
    close: vi.fn(),
    thumbnail: vi.fn(),
    original: vi.fn(),
    text: vi.fn(),
  }
  const manager = new ManageAttachments(drafts, gateway, vi.fn())
  managers.push(manager)
  return { drafts, gateway, manager }
}
it('retains successful upload A and retries only failed B', async () => {
  const { drafts, gateway, manager } = setup()
  vi.mocked(gateway.upload)
    .mockResolvedValueOnce(ready('A'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(ready('B'))
  await manager.add('conversation:a', [new File(['a'], 'A.txt'), new File(['b'], 'B.txt')])
  await vi.waitFor(() =>
    expect(drafts.get('conversation:a').attachments.map((item) => item.transfer)).toEqual([
      'stored',
      'failed',
    ]),
  )
  const b = drafts.get('conversation:a').attachments[1]!
  manager.retry('conversation:a', b.clientId)
  await vi.waitFor(() =>
    expect(drafts.get('conversation:a').attachments[1]?.transfer).toBe('stored'),
  )
  expect(drafts.get('conversation:a').attachments.map((item) => item.attachmentId)).toEqual([
    'A',
    'B',
  ])
  expect(gateway.upload).toHaveBeenCalledTimes(3)
  expect(vi.mocked(gateway.upload).mock.calls[1]?.[1].uploadId).toBe(
    vi.mocked(gateway.upload).mock.calls[2]?.[1].uploadId,
  )
})
it('late upload cannot revive an item removed from its original conversation', async () => {
  const { drafts, gateway, manager } = setup()
  let complete: ((value: AttachmentMetadata) => void) | undefined
  vi.mocked(gateway.upload).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  await manager.add('conversation:a', [new File(['a'], 'A.txt')])
  await vi.waitFor(() => expect(complete).toBeDefined())
  const id = drafts.get('conversation:a').attachments[0]!.clientId
  drafts.edit('conversation:b', { text: 'other draft' })
  manager.remove('conversation:a', id)
  complete!(ready('A'))
  await Promise.resolve()
  expect(drafts.get('conversation:a').attachments).toEqual([])
  expect(drafts.get('conversation:b').attachments).toEqual([])
  expect(drafts.get('conversation:b').text).toBe('other draft')
})
it('retries processing without uploading original bytes again', async () => {
  const { drafts, gateway, manager } = setup()
  vi.mocked(gateway.upload).mockResolvedValue({
    ...ready('A'),
    processing: {
      ...ready('A').processing!,
      state: 'failed',
      errorCode: 'PARSE_FAILED',
      retryable: true,
    },
  })
  vi.mocked(gateway.retry).mockResolvedValue({
    ...ready('A'),
    processing: { ...ready('A').processing!, preparationId: 'prep-new', revision: 0 },
  })
  await manager.add('a', [new File(['a'], 'A.txt')])
  await vi.waitFor(() => expect(drafts.get('a').attachments[0]?.processing).toBe('failed'))
  manager.retry('a', drafts.get('a').attachments[0]!.clientId)
  await vi.waitFor(() => expect(drafts.get('a').attachments[0]?.preparationId).toBe('prep-new'))
  expect(gateway.upload).toHaveBeenCalledTimes(1)
  expect(drafts.get('a').attachments[0]?.processingRevision).toBe(0)
})
it('closing a deleted conversation releases its lease and prevents late upload resurrection', async () => {
  const { drafts, gateway, manager } = setup()
  let complete: ((value: AttachmentMetadata) => void) | undefined
  vi.mocked(gateway.close).mockResolvedValue(undefined)
  vi.mocked(gateway.upload).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  await manager.add('conversation:deleted', [new File(['a'], 'A.txt')])
  await vi.waitFor(() => expect(complete).toBeDefined())
  const leaseId = drafts.get('conversation:deleted').id
  manager.close('conversation:deleted')
  complete!(ready('A'))
  await Promise.resolve()
  expect(gateway.close).toHaveBeenCalledWith(leaseId)
  expect(drafts.get('conversation:deleted').attachments).toEqual([])
})
it('renews an idle open draft without changing its selection revision and stops after close', async () => {
  vi.useFakeTimers()
  const { drafts, gateway, manager } = setup()
  vi.mocked(gateway.upload).mockResolvedValue(ready('A'))
  vi.mocked(gateway.close).mockResolvedValue(undefined)
  await manager.add('a', [new File(['a'], 'A.txt')])
  await vi.advanceTimersByTimeAsync(0)
  const revision = drafts.get('a').selectionRevision
  const before = vi.mocked(gateway.lease).mock.calls.length
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
  expect(gateway.lease).toHaveBeenCalledTimes(before + 1)
  expect(vi.mocked(gateway.lease).mock.calls.at(-1)?.[1].revision).toBe(revision)
  manager.close('a')
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
  expect(gateway.lease).toHaveBeenCalledTimes(before + 1)
})
