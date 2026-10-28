import { ref } from 'vue'
import { vi } from 'vitest'
import type {
  Conversation,
  GenerationStats,
  JobSnapshot,
  RuntimeEvent,
} from '@mlx-studio/api-client'
import type { ChatGateway } from '../modules/chat/application/ports'
import type { ChatState } from '../modules/chat/domain/chat-state'
import { projectConversation } from '../modules/chat/presentation/chat-projection'
import { createChatStream } from '../modules/chat/presentation/chat-stream-controller'

export function nativeStats(generationTokens = 8, generationTps = 12.5): GenerationStats {
  return {
    source: 'mlx-lm',
    generationTokens,
    generationTps,
    promptTokens: 16,
    promptTps: 100,
    cachedTokens: 0,
  }
}
export function jobSnapshot(
  text: string,
  textRevision: number,
  generationStats: GenerationStats | null = null,
): JobSnapshot {
  return {
    id: 'job',
    state: 'running',
    text,
    textRevision,
    generationStats,
    event_sequence: textRevision,
    instance_id: 'runtime',
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
export function chatGenerationFixture() {
  const state = ref<ChatState>({
    activeJobId: 'job',
    status: 'sending',
    error: null,
    messages: [{ id: 'job', role: 'assistant', content: '', state: 'streaming' }],
  })
  const conversationId = ref<string | null>('conversation')
  const gateway = {
    job: vi.fn<ChatGateway['job']>(),
    list: vi.fn(async () => []),
    get: vi.fn<ChatGateway['get']>(),
    upload: vi.fn(),
    sequence: vi.fn(async () => 0),
    submit: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    cancel: vi.fn(),
  }
  let receive: (event: RuntimeEvent) => void = () => undefined
  const release = vi.fn()
  const present = vi.fn((item: Conversation) => {
    state.value = projectConversation(state.value, item)
  })
  const stream = createChatStream({
    state,
    conversationId,
    gateway,
    present,
    refresh: vi.fn(),
    observe: (_id, _after, event) => {
      receive = event
      return release
    },
  })
  stream.start('job', 0)
  const emit = (type: string, payload: Record<string, unknown>) =>
    receive({ type, seq: 1, payload: { job_id: 'job', ...payload } })
  const delta = (text: string, textRevision: number, generationStats?: unknown) =>
    emit('generation.delta', {
      text,
      textRevision,
      ...(generationStats === undefined ? {} : { generationStats }),
    })
  return { state, conversationId, gateway, stream, present, release, emit, delta }
}
