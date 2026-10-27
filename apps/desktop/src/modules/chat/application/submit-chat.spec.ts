import { expect, it, vi } from 'vitest'
import { SubmitChat } from './submit-chat'

it('freezes the original web revision and exact body across a lost response', async () => {
  const settings = vi
    .fn()
    .mockResolvedValueOnce({ enabled: true, config_id: 'search', config_revision: 3 })
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce({ jobId: 'same' })
  const useCase = new SubmitChat({ upload: vi.fn(), sequence: async () => 0, submit })
  const input = {
    conversationId: 'conversation',
    content: 'Question',
    files: [],
    modelId: 'model',
    maxTokens: 64,
    temperature: 0,
    webSearch: { enabled: true },
    webSearchProvider: settings,
    draftIdentity: 'draft:3',
  }
  await expect(useCase.run(input)).rejects.toThrow('response lost')
  settings.mockResolvedValue({ enabled: true, config_id: 'search', config_revision: 4 })
  await useCase.run(input)
  expect(settings).toHaveBeenCalledTimes(1)
  expect(submit.mock.calls[0]?.[1]).toEqual(submit.mock.calls[1]?.[1])
  expect(submit.mock.calls[1]?.[1].web_search.config_revision).toBe(3)
})

it('preserves each successful legacy upload when another file fails', async () => {
  const upload = vi
    .fn()
    .mockResolvedValueOnce({ id: 'A' })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ id: 'B' })
  const submit = vi.fn().mockResolvedValue({ jobId: 'job' })
  const useCase = new SubmitChat({ upload, sequence: async () => 0, submit })
  const input = {
    conversationId: 'c',
    content: 'describe',
    modelId: 'm',
    maxTokens: 64,
    temperature: 0,
    files: [new File(['A'], 'A.png'), new File(['B'], 'B.png')],
  }
  await expect(useCase.run(input)).rejects.toThrow('offline')
  await useCase.run(input)
  expect(upload).toHaveBeenCalledTimes(3)
  expect(submit.mock.calls[0]?.[1].attachment_ids).toEqual(['A', 'B'])
})

it('does not reuse uploaded bytes when a newly selected file has identical metadata', async () => {
  const upload = vi
    .fn()
    .mockResolvedValueOnce({ id: 'first', mimeType: 'image/png', originalName: 'image.png' })
    .mockResolvedValueOnce({ id: 'second', mimeType: 'image/png', originalName: 'image.png' })
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce({ jobId: 'job' })
  const useCase = new SubmitChat({ upload, sequence: async () => 0, submit })
  const input = {
    conversationId: 'conversation',
    content: 'Describe this',
    modelId: 'vision',
    maxTokens: 64,
    temperature: 0,
    files: [new File(['a'], 'image.png', { lastModified: 1 })],
  }
  await expect(useCase.run(input)).rejects.toThrow('response lost')
  await useCase.run({
    ...input,
    files: [new File(['b'], 'image.png', { lastModified: 1 })],
  })
  expect(upload).toHaveBeenCalledTimes(2)
  expect(submit.mock.calls[1]?.[1].attachment_ids).toEqual(['second'])
  expect(submit.mock.calls[1]?.[1].client_request_id).not.toBe(
    submit.mock.calls[0]?.[1].client_request_id,
  )
})
