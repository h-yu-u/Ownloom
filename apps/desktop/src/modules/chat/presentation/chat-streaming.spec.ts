import { modelFixture } from '../../../test-fixtures/runtime'
import { ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { Conversation, RuntimeEvent } from '@mlx-studio/api-client'
import { createChatController } from './chat-controller'

function setup() {
  let receive: (event: RuntimeEvent) => void = () => undefined
  const release = vi.fn()
  const gateway = {
    upload: vi.fn(),
    sequence: vi.fn(async () => 0),
    submit: vi.fn(async () => ({ jobId: 'job' })),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn<() => Promise<Conversation[]>>(async () => []),
    get: vi.fn(async () => ({
      id: 'conversation',
      title: 'test',
      modelId: 'model',
      pinned: false,
      messages: [
        {
          id: 'saved',
          role: 'assistant' as const,
          content: 'AB',
          turnId: 'turn',
          attachments: [],
          parameters: { finishReason: 'length' },
        },
      ],
    })),
    job: vi.fn(),
  }
  const controller = createChatController({
    gateway,
    models: ref([modelFixture({ id: 'model' })]),
    refreshModels: vi.fn(),
    exportText: vi.fn(),
    observe: (_id, _after, event) => {
      receive = event
      return release
    },
  })
  controller.conversationId.value = 'conversation'
  controller.selectedModelId.value = 'model'
  return { controller, gateway, release, receive: (event: RuntimeEvent) => receive(event) }
}
afterEach(() => vi.useRealTimers())
it('refreshes the accepted conversation title while the assistant is still streaming', async () => {
  const { controller, gateway } = setup()
  const conversation = { ...(await gateway.get()), title: '帮我搭建一个图' }
  gateway.list.mockResolvedValue([conversation])
  await controller.send('帮我搭建一个图书馆系统')
  await vi.waitFor(() => expect(controller.conversations.value[0]?.title).toBe('帮我搭建一个图'))
  expect(controller.state.value.status).toBe('sending')
  controller.dispose()
})
it('ignores a late title refresh failure after leaving the conversation', async () => {
  const { controller, gateway } = setup()
  let fail!: (cause: Error) => void
  const names = new Promise<Conversation[]>((_resolve, reject) => {
    fail = reject
  })
  gateway.list.mockReturnValueOnce(names)
  await controller.send('帮我搭建一个图书馆系统')
  controller.dispose()
  fail(new Error('late failure'))
  await names.catch(() => undefined)
  expect(controller.state.value.error).toBeNull()
})
it('explains that dated evidence is unavailable instead of showing a generic generation error', async () => {
  const { controller, receive } = setup()
  await controller.send('今日热点')
  receive({
    type: 'job.failed',
    seq: 1,
    payload: { job_id: 'job', error_code: 'WEB_FRESHNESS_UNVERIFIED' },
  })
  expect(controller.state.value.errorCode).toBe('WEB_FRESHNESS_UNVERIFIED')
  expect(controller.state.value.error).toContain('不会使用旧网页作为今日信息')
  expect(controller.state.value.status).toBe('error')
  controller.dispose()
})
it('ignores duplicate deltas and replaces text from a snapshot when a revision is skipped', async () => {
  const { controller, gateway, receive } = setup()
  gateway.job.mockResolvedValue({
    id: 'job',
    state: 'running',
    text: 'ABC',
    textRevision: 3,
    projectionVersion: 5,
    phase: 'generating',
    sources: [],
    event_sequence: 9,
    instance_id: 'runtime',
  })
  await controller.send('hello')
  receive({
    type: 'generation.delta',
    seq: 1,
    payload: { job_id: 'job', text: 'A', textRevision: 1 },
  })
  receive({
    type: 'generation.delta',
    seq: 2,
    payload: { job_id: 'job', text: 'A', textRevision: 1 },
  })
  expect(controller.state.value.messages.at(-1)?.content).toBe('A')
  receive({
    type: 'generation.delta',
    seq: 3,
    payload: { job_id: 'job', text: 'C', textRevision: 3 },
  })
  await vi.waitFor(() => expect(controller.state.value.messages.at(-1)?.content).toBe('ABC'))
  receive({
    type: 'generation.delta',
    seq: 4,
    payload: { job_id: 'job', text: 'D', textRevision: 4 },
  })
  await vi.waitFor(() => expect(controller.state.value.messages.at(-1)?.content).toBe('ABCD'))
  controller.dispose()
})
it('does not regress phase when a late older projection event arrives', async () => {
  const { controller, receive } = setup()
  await controller.send('hello')
  receive({
    type: 'job.phase_changed',
    seq: 1,
    payload: { job_id: 'job', phase: 'generating', projectionVersion: 5 },
  })
  receive({
    type: 'job.phase_changed',
    seq: 2,
    payload: { job_id: 'job', phase: 'loading_model', projectionVersion: 4 },
  })
  expect(controller.phase.value).toBe('generating')
  controller.dispose()
})
it('flushes pending text before cancellation and stops late output', async () => {
  vi.useFakeTimers()
  const { controller, receive, release } = setup()
  await controller.send('hello')
  receive({ type: 'generation.delta', seq: 1, payload: { job_id: 'job', text: 'A' } })
  receive({ type: 'generation.delta', seq: 2, payload: { job_id: 'job', text: 'B' } })
  expect(controller.state.value.messages.at(-1)?.content).toBe('A')
  receive({ type: 'job.cancelled', seq: 3, payload: { job_id: 'job' } })
  expect(controller.state.value.messages.at(-1)?.content).toBe('AB')
  expect(controller.busy.value).toBe(false)
  expect(release).toHaveBeenCalledOnce()
  receive({ type: 'generation.delta', seq: 4, payload: { job_id: 'job', text: 'late' } })
  vi.runAllTimers()
  expect(controller.state.value.messages.at(-1)?.content).toBe('AB')
  controller.dispose()
})
it('preserves truncation metadata when replacing the stream with persisted messages', async () => {
  const { controller, gateway, receive } = setup()
  expect(controller.maxTokens.value).toBeNull()
  controller.maxTokens.value = 32768
  controller.resetParameters()
  expect(controller.maxTokens.value).toBeNull()
  await controller.send('hello')
  expect(gateway.submit).toHaveBeenCalledWith(
    'conversation',
    expect.objectContaining({ max_tokens: null }),
  )
  receive({ type: 'generation.delta', seq: 1, payload: { job_id: 'job', text: 'AB' } })
  receive({ type: 'job.succeeded', seq: 2, payload: { job_id: 'job', finish_reason: 'length' } })
  await vi.waitFor(() => expect(controller.state.value.messages.at(-1)?.id).toBe('saved'))
  expect(controller.state.value.messages.at(-1)?.finishReason).toBe('length')
  controller.dispose()
})
