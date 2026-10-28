import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Conversation, Submission } from '@mlx-studio/api-client'
import { modelFixture } from '../../../test-fixtures/runtime'
import type { ChatGateway } from '../application/ports'
import type { AttachmentGateway } from '../application/attachment-ports'
import { createChatController } from './chat-controller'
import { createChatDraftController } from './chat-draft-controller'

function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => (resolve = done)), resolve }
}
const conversation = (id: string): Conversation => ({
  id,
  title: id,
  pinned: false,
  modelId: 'model',
  messages: [],
})
const controllers: ReturnType<typeof createChatController>[] = []
afterEach(() => controllers.splice(0).forEach((controller) => controller.dispose()))
function setup() {
  const gateway: ChatGateway = {
    upload: vi.fn(),
    sequence: vi.fn(async () => 0),
    submit: vi.fn(async () => ({ jobId: 'job' })),
    attempt: vi.fn(async () => ({ jobId: 'job', state: 'queued' })),
    create: vi.fn(async () => conversation('created')),
    delete: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(async () => [conversation('A')]),
    get: vi.fn(async (id: string) => conversation(id)),
    job: vi.fn(async () => ({
      id: 'job',
      state: 'running',
      text: '',
      event_sequence: 1,
      instance_id: 'runtime',
    })),
  }
  const attachments: AttachmentGateway = {
    upload: vi.fn(),
    metadata: vi.fn(),
    retry: vi.fn(),
    lease: vi.fn(async () => undefined),
    close: vi.fn(),
    thumbnail: vi.fn(),
    original: vi.fn(),
    text: vi.fn(),
  }
  const observe = vi.fn(() => vi.fn())
  const controller = createChatController({
    gateway,
    draftFactory: (id) => createChatDraftController(id, attachments, vi.fn()),
    models: ref([modelFixture({ id: 'model' })]),
    refreshModels: vi.fn(async () => undefined),
    exportText: vi.fn(),
    observe,
  })
  controller.conversationId.value = 'A'
  controller.selectedModelId.value = 'model'
  controllers.push(controller)
  return { controller, gateway, observe }
}

it.each(['send', 'attempt'] as const)(
  'blocks %s while another conversation is loading',
  async (kind) => {
    const { controller, gateway } = setup()
    const next = deferred<Conversation>()
    vi.mocked(gateway.get).mockReturnValueOnce(next.promise)
    const navigation = controller.openConversation('B')
    if (kind === 'send') await controller.send('belongs to A')
    else await controller.attempt('user-A', 'reuse_context')
    next.resolve(conversation('B'))
    await navigation
    expect(gateway.submit).not.toHaveBeenCalled()
    expect(gateway.attempt).not.toHaveBeenCalled()
    expect(controller.conversationId.value).toBe('B')
    expect(controller.state.value.messages).toEqual([])
  },
)

it.each(['get', 'create'] as const)(
  'can observe the next submission after %s navigation fails',
  async (operation) => {
    const { controller, gateway, observe } = setup()
    vi.mocked(gateway[operation]).mockRejectedValueOnce(new Error('read failed'))
    await expect(
      operation === 'get' ? controller.openConversation('B') : controller.newConversation(),
    ).rejects.toThrow('read failed')
    expect(controller.pending.value).toBe(false)
    await controller.send('still in A')
    expect(observe).toHaveBeenCalledOnce()
    expect(gateway.submit).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ content: 'still in A' }),
    )
  },
)

it('does not submit while a workspace snapshot is still being restored', async () => {
  const { controller, gateway } = setup()
  const items = deferred<Conversation[]>()
  vi.mocked(gateway.list).mockReturnValueOnce(items.promise)
  const loading = controller.loadWorkspace()
  await vi.waitFor(() => expect(gateway.list).toHaveBeenCalledOnce())
  const sent = await controller.send('wait for the restored conversation')
  items.resolve([conversation('A')])
  await loading
  expect(sent).toBe(false)
  expect(gateway.submit).not.toHaveBeenCalled()
})

it('consumes an accepted draft after leaving without restarting observation, and resumes on return', async () => {
  const { controller, gateway, observe } = setup()
  const receipt = deferred<Submission>()
  vi.mocked(gateway.submit).mockReturnValueOnce(receipt.promise)
  controller.drafts!.setText('hello')
  const sending = controller.send('hello')
  await vi.waitFor(() => expect(gateway.submit).toHaveBeenCalledOnce())
  controller.dispose()
  receipt.resolve({ jobId: 'job', state: 'queued' })
  expect(await sending).toBe(true)
  expect(controller.drafts!.draft.value.text).toBe('')
  expect(observe).not.toHaveBeenCalled()
  expect(gateway.cancel).not.toHaveBeenCalled()
  vi.mocked(gateway.get).mockResolvedValue({ ...conversation('A'), activeJobId: 'job' })
  await controller.loadWorkspace()
  expect(controller.state.value.activeJobId).toBe('job')
  expect(observe).toHaveBeenCalledOnce()
})

it('refreshes the current view when it was reopened before an acceptance receipt arrived', async () => {
  const { controller, gateway, observe } = setup()
  const receipt = deferred<Submission>()
  vi.mocked(gateway.submit).mockReturnValueOnce(receipt.promise)
  const sending = controller.send('hello')
  await vi.waitFor(() => expect(gateway.submit).toHaveBeenCalledOnce())
  controller.dispose()
  await controller.loadWorkspace()
  vi.mocked(gateway.get).mockResolvedValue({ ...conversation('A'), activeJobId: 'job' })
  receipt.resolve({ jobId: 'job', state: 'queued' })
  await sending
  await vi.waitFor(() => expect(controller.state.value.activeJobId).toBe('job'))
  expect(observe).toHaveBeenCalledOnce()
  expect(gateway.submit).toHaveBeenCalledOnce()
})

it('keeps a newly created conversation and its accepted draft when creation finishes off-page', async () => {
  const { controller, gateway, observe } = setup()
  const created = deferred<Conversation>()
  vi.mocked(gateway.create).mockReturnValueOnce(created.promise)
  controller.conversationId.value = null
  controller.drafts!.setText('new draft')
  const sending = controller.send('new draft')
  controller.dispose()
  created.resolve(conversation('created'))
  expect(await sending).toBe(true)
  expect(gateway.submit).toHaveBeenCalledWith(
    'created',
    expect.objectContaining({ content: 'new draft' }),
  )
  expect(controller.conversationId.value).toBe('created')
  expect(controller.drafts!.draft.value.text).toBe('')
  expect(observe).not.toHaveBeenCalled()
})

it('does not restart an answer-attempt observer after the page leaves', async () => {
  const { controller, gateway, observe } = setup()
  const receipt = deferred<Submission>()
  vi.mocked(gateway.attempt!).mockReturnValueOnce(receipt.promise)
  const attempt = controller.attempt('user-A', 'reuse_context')
  await vi.waitFor(() => expect(gateway.attempt).toHaveBeenCalledOnce())
  controller.dispose()
  receipt.resolve({ jobId: 'job', state: 'queued' })
  await attempt
  expect(observe).not.toHaveBeenCalled()
  expect(gateway.cancel).not.toHaveBeenCalled()
})
