import { useModelDirectoryState } from '../../../capabilities/models/directory'
import { installWorkspaces } from '../../../app/composition-root'
import { modelFixture } from '../../../test-fixtures/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from './chat.store'

let eventSequence = 10
afterEach(() => useChatStore().dispose())

const api = vi.hoisted(() => ({
  delete: vi.fn(),
  patch: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../../../platform/runtime-bridge', () => ({
  runtimeClient: async () => api,
  runtimeConnectionStatus: { value: 'ready' },
  restartRuntimeProcess: vi.fn(),
}))

function populatedStore(): ReturnType<typeof useChatStore> {
  const store = useChatStore()
  store.selectedModelId = 'qwen-local'
  store.conversationId = 'current'
  store.conversations = [
    { id: 'current', title: '当前会话', pinned: false, modelId: null, messages: [] },
    { id: 'other', title: '保留会话', pinned: false, modelId: null, messages: [] },
  ]
  store.state.messages = [{ id: 'message', role: 'user', content: 'hello' }]
  return store
}

describe('chat workspace actions', () => {
  beforeEach(() => {
    eventSequence = 10
    setActivePinia(createPinia())
    useModelDirectoryState().items = [modelFixture({ id: 'qwen-local' })]
    api.delete.mockReset()
    api.patch.mockReset()
    api.get.mockReset()
    api.post.mockReset()
    api.subscribe.mockReset()
  })

  it.each(['job.succeeded', 'job.failed', 'job.cancelled'])(
    'keeps the chat subscription alive after another job emits %s',
    async (type) => {
      let receive:
        | ((event: { type: string; seq: number; payload: Record<string, unknown> }) => void)
        | undefined
      let signal: AbortSignal | undefined
      api.subscribe.mockImplementation((handler, abortSignal) => {
        receive = handler
        signal = abortSignal
        return new Promise(() => {})
      })
      api.post.mockResolvedValue({ jobId: 'chat-a', state: 'queued' })
      api.get.mockResolvedValue({ event_sequence: 0 })
      const store = populatedStore()
      await store.send('hello')
      await vi.waitFor(() => expect(receive).toBeDefined())
      const requests = api.get.mock.calls.length
      receive?.({ seq: ++eventSequence, type, payload: { job_id: 'image-b' } })
      expect(signal?.aborted).toBe(false)
      expect(api.get).toHaveBeenCalledTimes(requests)
      expect(store.state.activeJobId).toBe('chat-a')
      receive?.({
        seq: ++eventSequence,
        type: 'generation.delta',
        payload: { job_id: 'chat-a', text: 'still here' },
      })
      expect(store.state.messages.at(-1)?.content).toBe('still here')
      receive?.({ seq: ++eventSequence, type: 'job.cancelled', payload: { job_id: 'chat-a' } })
      expect(signal?.aborted).toBe(true)
      expect(store.busy).toBe(false)
    },
  )

  it('sends the selected real model and renders its streamed reply', async () => {
    let receive:
      | ((event: { type: string; seq: number; payload: Record<string, unknown> }) => void)
      | undefined
    api.subscribe.mockImplementation((handler) => {
      receive = handler
      return new Promise(() => {})
    })
    api.post.mockResolvedValue({ jobId: 'real-job', state: 'queued' })
    api.get.mockImplementation(async (path: string) => {
      if (path.includes('/runtime/info')) return { event_sequence: 3 }
      if (path === '/internal/v1/conversations') return []
      return {
        id: 'local-chat',
        title: 'Chat',
        modelId: 'qwen-local',
        messages: [
          {
            turnId: 'user-1',
            attachments: [],
            parameters: {},
            id: 'user-1',
            role: 'user',
            content: '你好',
          },
          {
            turnId: 'user-1',
            attachments: [],
            parameters: {},
            id: 'assistant-1',
            role: 'assistant',
            content: '你好，我是本地模型。',
          },
        ],
      }
    })
    const store = useChatStore()
    store.conversationId = 'local-chat'
    store.selectedModelId = 'qwen-local'
    await store.send('你好')
    expect(api.post).toHaveBeenCalledWith(
      '/internal/v1/conversations/local-chat/messages',
      expect.objectContaining({ model_id: 'qwen-local', content: '你好' }),
    )
    await vi.waitFor(() => expect(receive).toBeDefined())
    receive?.({
      seq: ++eventSequence,
      type: 'generation.delta',
      payload: { job_id: 'real-job', text: '你好，' },
    })
    expect(store.state.messages.at(-1)?.content).toBe('你好，')
    receive?.({
      seq: ++eventSequence,
      type: 'generation.delta',
      payload: { job_id: 'real-job', text: '我是本地模型。' },
    })
    receive?.({ seq: ++eventSequence, type: 'job.succeeded', payload: { job_id: 'real-job' } })
    await vi.waitFor(() => expect(store.state.messages.at(-1)?.id).toBe('assistant-1'))
    expect(store.state.messages.at(-1)?.content).toBe('你好，我是本地模型。')
    expect(store.busy).toBe(false)
  })

  it('defaults to a real local model when FakeEngine is also registered', async () => {
    api.get.mockImplementation(async (path: string) =>
      path.includes('/models')
        ? [
            modelFixture({
              id: 'fake',
              source: 'builtin',
              engine: 'fake',
              outputModalities: ['text'],
            }),
            modelFixture({
              id: 'qwen-local',
              engine: 'mlx-vlm',
              outputModalities: ['text'],
              state: 'available',
            }),
          ]
        : [],
    )
    const store = useChatStore()
    await store.loadWorkspace()
    expect(store.selectedModelId).toBe('qwen-local')
  })

  it('preserves an explicit model selection when refreshing the workspace', async () => {
    api.get.mockImplementation(async (path: string) =>
      path.includes('/models')
        ? [
            modelFixture({
              id: 'fake',
              source: 'builtin',
              engine: 'fake',
              outputModalities: ['text'],
            }),
            modelFixture({ id: 'qwen-local', engine: 'mlx-vlm', outputModalities: ['text'] }),
          ]
        : [],
    )
    const store = useChatStore()
    store.selectedModelId = 'fake'
    await store.loadWorkspace()
    expect(store.selectedModelId).toBe('fake')
  })

  it('removes only the current conversation after the API succeeds', async () => {
    const store = populatedStore()
    await store.clearConversation()
    expect(api.delete).toHaveBeenCalledWith('/internal/v1/conversations/current')
    expect(store.conversations.map((item) => item.id)).toEqual(['other'])
    expect(store.conversationId).toBeNull()
    expect(store.state.messages).toEqual([])
  })

  it('preserves messages and selection if deletion fails', async () => {
    const store = populatedStore()
    api.delete.mockRejectedValue(new Error('offline'))
    await expect(store.clearConversation()).rejects.toThrow('offline')
    expect(store.conversationId).toBe('current')
    expect(store.state.messages).toHaveLength(1)
    expect(store.conversations).toHaveLength(2)
  })

  it('renames and pins only after persistence succeeds, and preserves selection', async () => {
    const store = populatedStore()
    api.patch.mockResolvedValueOnce({ id: 'other', title: '新名称', pinned: false })
    await store.renameConversation('other', '  新名称  ')
    expect(api.patch).toHaveBeenLastCalledWith('/internal/v1/conversations/other', {
      title: '新名称',
    })
    expect(store.conversations[1]?.title).toBe('新名称')
    expect(store.conversationId).toBe('current')
    api.patch.mockResolvedValueOnce({ id: 'other', title: '新名称', pinned: true })
    await store.toggleConversationPin('other')
    expect(api.patch).toHaveBeenLastCalledWith('/internal/v1/conversations/other', { pinned: true })
    expect(store.conversations[1]?.pinned).toBe(true)
    api.patch.mockRejectedValueOnce(new Error('offline'))
    await expect(store.toggleConversationPin('other')).rejects.toThrow('offline')
    expect(store.conversations[1]?.pinned).toBe(true)
    expect(store.pending).toBe(false)
  })

  it('rejects blank names and keeps old titles when renaming fails', async () => {
    const store = populatedStore()
    await expect(store.renameConversation('current', '   ')).rejects.toThrow()
    expect(api.patch).not.toHaveBeenCalled()
    api.patch.mockRejectedValueOnce(new Error('offline'))
    await expect(store.renameConversation('current', '新名称')).rejects.toThrow('offline')
    expect(store.conversations[0]?.title).toBe('当前会话')
  })

  it('deletes a different conversation without clearing the current messages', async () => {
    const store = populatedStore()
    await store.deleteConversation('other')
    expect(api.delete).toHaveBeenCalledWith('/internal/v1/conversations/other')
    expect(store.conversations.map((item) => item.id)).toEqual(['current'])
    expect(store.conversationId).toBe('current')
    expect(store.state.messages).toHaveLength(1)
  })

  it('locks metadata actions during generation', async () => {
    const store = populatedStore()
    store.state.status = 'sending'
    await store.renameConversation('current', '新名称')
    await store.toggleConversationPin('current')
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('cannot delete a conversation during generation', async () => {
    const store = populatedStore()
    store.state.status = 'sending'
    await store.clearConversation()
    expect(api.delete).not.toHaveBeenCalled()
    expect(store.conversationId).toBe('current')
  })
})

installWorkspaces()

describe('chat recovery and exclusion', () => {
  beforeEach(() => {
    eventSequence = 10
    setActivePinia(createPinia())
    useModelDirectoryState().items = [modelFixture({ id: 'qwen-local' })]
    api.get.mockReset()
    api.post.mockReset()
    api.subscribe.mockReset()
  })
  const persisted = {
    id: 'current',
    title: 'Chat',
    modelId: 'model',
    messages: [
      {
        id: 'user',
        turnId: 'turn',
        role: 'user',
        content: 'hello',
        parameters: {},
        attachments: [],
      },
      {
        id: 'saved',
        turnId: 'turn',
        role: 'assistant',
        content: 'saved reply',
        parameters: {},
        attachments: [],
      },
    ],
  }
  it('recovers a completed idempotent submission even if its terminal event predates observation', async () => {
    api.post.mockResolvedValue({ jobId: 'recovered', state: 'accepted' })
    api.get.mockImplementation(async (path: string) =>
      path.includes('/jobs/')
        ? {
            id: 'recovered',
            state: 'succeeded',
            text: 'saved reply',
            event_sequence: 100,
            instance_id: 'runtime',
          }
        : path.endsWith('/runtime/info')
          ? { event_sequence: 100, instance_id: 'runtime' }
          : path.endsWith('/conversations')
            ? []
            : persisted,
    )
    const store = populatedStore()
    await store.send('hello')
    await vi.waitFor(() => expect(store.state.messages.at(-1)?.id).toBe('saved'))
    expect(store.busy).toBe(false)
    expect(api.subscribe).not.toHaveBeenCalled()
  })
  it('resumes a background job after leaving and returning without cancelling it', async () => {
    let terminal = false
    let signal: AbortSignal | undefined
    api.subscribe.mockImplementation((_, owner: AbortSignal) => {
      signal = owner
      return new Promise(() => {})
    })
    api.post.mockResolvedValue({ jobId: 'background', state: 'queued' })
    api.get.mockImplementation(async (path: string) =>
      path.includes('/jobs/')
        ? {
            id: 'background',
            state: terminal ? 'succeeded' : 'running',
            text: '',
            event_sequence: 5,
            instance_id: 'runtime',
          }
        : path.endsWith('/runtime/info')
          ? { event_sequence: 0, instance_id: 'runtime' }
          : path.endsWith('/conversations')
            ? []
            : persisted,
    )
    const store = populatedStore()
    await store.send('hello')
    await vi.waitFor(() => expect(signal).toBeDefined())
    store.dispose()
    expect(signal?.aborted).toBe(true)
    expect(store.busy).toBe(true)
    terminal = true
    await store.loadWorkspace()
    expect(store.busy).toBe(false)
    expect(store.state.messages.at(-1)?.content).toBe('saved reply')
    expect(api.post).toHaveBeenCalledTimes(1)
  })
  it('owns exclusion before the first await and retains one retry identity on a failed response', async () => {
    api.get.mockResolvedValue({ event_sequence: 0 })
    api.post.mockRejectedValueOnce(new Error('response lost'))
    const store = populatedStore()
    const first = store.send('hello')
    expect(await store.send('hello')).toBe(false)
    await expect(first).rejects.toThrow('response lost')
    api.post.mockResolvedValue({ jobId: 'retry', state: 'queued' })
    api.subscribe.mockReturnValue(new Promise(() => {}))
    await store.send('hello')
    const firstRequest = api.post.mock.calls[0]?.[1] as { client_request_id: string }
    const retry = api.post.mock.calls[1]?.[1] as { client_request_id: string }
    expect(retry.client_request_id).toBe(firstRequest.client_request_id)
    store.dispose()
  })
  it('ignores an older conversation result after a newer selection has loaded', async () => {
    let finish: (value: unknown) => void = () => undefined
    api.get.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    api.get.mockResolvedValueOnce({ ...persisted, id: 'b', title: 'B' })
    const store = useChatStore()
    const old = store.openConversation('a')
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledOnce())
    await store.openConversation('b')
    finish({ ...persisted, id: 'a', title: 'A' })
    await old
    expect(store.conversationId).toBe('b')
  })
})
