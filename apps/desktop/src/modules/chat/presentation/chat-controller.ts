import { deriveTaskReadiness } from '../../../capabilities/models'
import { createExportOperation } from '../../../shared/lib/export-operation'
import type { FileExportResult } from '../../../shared/lib/file-export'
import type { ExtensionSelection } from '@mlx-studio/api-client'
import { computed, ref, type Ref } from 'vue'
import type {
  Conversation,
  ConversationPatch,
  ModelSummary,
  RuntimeEvent,
} from '@mlx-studio/api-client'
import { conversationTitle } from '../domain/conversation-list'
import { formatConversation } from '../domain/export-conversation'
import { SubmitChat, submissionAttachments } from '../application/submit-chat'
import {
  initialChatState,
  reduceChatState,
  type ChatState,
  type ChatMessage,
} from '../domain/chat-state'
import type { ChatGateway } from '../application/ports'
import { createChatStream } from './chat-stream-controller'
import type { createChatDraftController } from './chat-draft-controller'
import { createChatAttempts } from './chat-attempts'

interface ChatDependencies {
  gateway: ChatGateway
  draftFactory?: (
    conversationId: Ref<string | null>,
  ) => ReturnType<typeof createChatDraftController>
  runtimeAvailable?(): boolean
  models: Readonly<Ref<readonly ModelSummary[]>>
  refreshModels(): Promise<void>
  exportText(content: string, filename: string): Promise<FileExportResult>
  observe(
    id: string,
    after: number,
    event: (event: RuntimeEvent) => void,
    resync: () => Promise<number | void>,
  ): () => void
}
export function createChatController(deps: ChatDependencies) {
  const state = ref<ChatState>({ ...initialChatState, messages: [] })
  const conversations = ref<Conversation[]>([])
  const conversationId = ref<string | null>(null)
  const selectedModelId = ref('')
  const pending = ref(false)
  const maxTokens = ref<number | null>(null)
  const nextCursor = ref<string | null>(null)
  const temperature = ref(0.7)
  const models = computed(() =>
    deps.models.value
      .filter((model) => model.outputModalities.includes('text'))
      .map((model) => ({ ...model, multiImage: model.capabilities.multiImage === true })),
  )
  const readiness = computed(() =>
    deriveTaskReadiness(
      deps.models.value.find((item) => item.id === selectedModelId.value),
      { available: deps.runtimeAvailable?.() ?? true },
      { output: 'text' },
    ),
  )
  const busy = computed(() => state.value.status === 'sending')
  const submission = new SubmitChat(deps.gateway)
  let readEpoch = 0
  let readAbort: AbortController | undefined
  let viewActive = true
  let viewEpoch = 0
  const drafts = deps.draftFactory?.(conversationId)
  const stream = createChatStream({
    gateway: deps.gateway,
    state,
    conversationId,
    present,
    refresh: (items) => {
      conversations.value = items
    },
    observe: deps.observe,
  })
  const attempt = createChatAttempts({
    gateway: deps.gateway,
    state,
    conversationId,
    pending,
    modelId: selectedModelId,
    maxTokens,
    temperature,
    start: stream.start,
  })

  function present(item: Conversation, selectModel = true): void {
    nextCursor.value = item.nextCursor ?? null
    drafts?.restore(item)
    conversationId.value = item.id
    if (selectModel) selectedModelId.value = item.modelId ?? selectedModelId.value
    const messages: ChatMessage[] = item.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        ...message,
        role: message.role === 'user' ? 'user' : 'assistant',
        state: 'complete',
        finishReason: message.parameters.finishReason === 'length' ? 'length' : undefined,
      }))
    state.value = reduceChatState(state.value, { type: 'conversation.loaded', messages })
    if (item.activeJobId)
      state.value = {
        ...state.value,
        status: 'sending',
        activeJobId: item.activeJobId,
        messages: [
          ...messages,
          { id: item.activeJobId, role: 'assistant', content: '', state: 'streaming' },
        ],
      }
  }
  async function openConversation(id: string): Promise<void> {
    if (pending.value) return
    stream.dispose()
    const epoch = ++readEpoch
    readAbort?.abort()
    readAbort = new AbortController()
    const item = await deps.gateway.get(id, readAbort.signal)
    if (epoch === readEpoch) {
      present(item)
      await stream.resume()
    }
  }
  async function loadMore(): Promise<void> {
    const id = conversationId.value,
      cursor = nextCursor.value,
      owner = readEpoch
    if (!id || !cursor || !deps.gateway.page) return
    const page = await deps.gateway.page(id, cursor)
    if (owner !== readEpoch || cursor !== nextCursor.value || id !== conversationId.value) return
    const known = new Set(state.value.messages.map((item) => item.id))
    const older = page.messages
      .filter((item) => !known.has(item.id))
      .map((item) => ({
        ...item,
        role: item.role === 'user' ? ('user' as const) : ('assistant' as const),
        state: 'complete' as const,
      }))
    state.value = { ...state.value, messages: [...older, ...state.value.messages] }
    nextCursor.value = page.nextCursor ?? null
  }
  async function loadWorkspace(): Promise<void> {
    viewActive = true
    const owner = ++viewEpoch
    if (pending.value) return
    if (busy.value && state.value.activeJobId) {
      await stream.resume()
      return
    }
    await stream.resume()
    state.value = { ...state.value, status: 'loading', error: null }
    try {
      const [, items] = await Promise.all([deps.refreshModels(), deps.gateway.list()])
      if (owner !== viewEpoch || !viewActive) return
      conversations.value = items
      if (!models.value.some((model) => model.id === selectedModelId.value)) {
        selectedModelId.value =
          models.value.find((model) => model.source !== 'builtin' && model.state === 'loaded')
            ?.id ??
          models.value.find((model) => model.source !== 'builtin')?.id ??
          models.value[0]?.id ??
          ''
      }
      state.value = { ...state.value, status: 'idle' }
      if (conversationId.value) await openConversation(conversationId.value)
    } catch (cause) {
      state.value = { ...state.value, status: 'error', error: errorText(cause) }
    }
  }
  async function newConversation(): Promise<void> {
    if (pending.value) return
    stream.dispose()
    pending.value = true
    try {
      const item = await deps.gateway.create(selectedModelId.value)
      readEpoch += 1
      present(item)
      conversations.value = [item, ...conversations.value]
    } finally {
      pending.value = false
    }
  }
  async function deleteConversation(id: string): Promise<void> {
    if (busy.value || pending.value) return
    pending.value = true
    try {
      await deps.gateway.delete(id)
      drafts?.discard(id)
      readEpoch += 1
      readAbort?.abort()
      conversations.value = conversations.value.filter((item) => item.id !== id)
      if (conversationId.value === id) {
        stream.dispose()
        conversationId.value = null
        state.value = { ...initialChatState, messages: [] }
      }
    } finally {
      pending.value = false
    }
  }
  async function clearConversation(): Promise<void> {
    if (conversationId.value) await deleteConversation(conversationId.value)
  }
  async function updateConversation(id: string, patch: ConversationPatch): Promise<void> {
    if (busy.value || pending.value) return
    pending.value = true
    try {
      const updated = await deps.gateway.update(id, patch)
      conversations.value = conversations.value.map((item) => (item.id === id ? updated : item))
    } finally {
      pending.value = false
    }
  }
  async function renameConversation(id: string, title: string): Promise<void> {
    await updateConversation(id, { title: conversationTitle(title) })
  }
  async function toggleConversationPin(id: string): Promise<void> {
    const item = conversations.value.find((entry) => entry.id === id)
    if (item) await updateConversation(id, { pinned: !item.pinned })
  }
  async function send(
    content: string,
    files: File[] = [],
    selection?: ExtensionSelection,
  ): Promise<boolean> {
    if (!readiness.value.submitAllowed) return false
    const draft = drafts?.draft.value.text === content ? drafts.draft.value : undefined
    if (
      (!content.trim() && !files.length && !draft?.attachments.length) ||
      busy.value ||
      pending.value
    )
      return false
    pending.value = true
    try {
      if (!conversationId.value) {
        const item = await deps.gateway.create(selectedModelId.value)
        drafts?.bind(item.id)
        present(item)
        conversations.value = [item, ...conversations.value]
      }
      const result = await submission.run({
        conversationId: conversationId.value!,
        content,
        files,
        attachments: files.length ? undefined : submissionAttachments(draft),
        draftIdentity: draft ? `${draft.id}:${draft.revision}` : undefined,
        webSearch: { enabled: draft?.webSearchEnabled ?? false },
        webSearchProvider: draft?.webSearchEnabled ? deps.gateway.webSearch : undefined,
        visualSelection: draft?.visualSelection,
        selection,
        modelId: selectedModelId.value,
        maxTokens: maxTokens.value,
        temperature: temperature.value,
      })
      if (!result) return false
      if (draft) drafts?.consume(draft.key, draft.revision)
      state.value = reduceChatState(state.value, {
        type: 'send.started',
        userMessage: {
          id: result.userMessageId ?? crypto.randomUUID(),
          role: 'user',
          content: result.content,
          state: 'complete',
          attachments: result.attachments,
        },
        assistantMessage: { id: result.jobId, role: 'assistant', content: '', state: 'streaming' },
      })
      stream.start(result.jobId, result.after)
      return true
    } finally {
      pending.value = false
    }
  }
  async function cancel(): Promise<void> {
    if (state.value.activeJobId && conversationId.value)
      await deps.gateway.cancel(conversationId.value, state.value.activeJobId)
  }
  function resetParameters(): void {
    if (!busy.value && !pending.value) {
      maxTokens.value = null
      temperature.value = 0.7
    }
  }
  const exporting = createExportOperation()
  async function exportConversation() {
    const title =
      conversations.value.find((item) => item.id === conversationId.value)?.title ?? '本地对话'
    const content = formatConversation(title, state.value.messages)
    return exporting.run({
      id: conversationId.value ?? 'new',
      read: async () => new Blob([content]),
      write: () => deps.exportText(content, 'ownloom-conversation.md'),
    })
  }
  function dispose(): void {
    exporting.invalidate()
    stream.dispose()
    drafts?.disposePreview()
    viewActive = false
    viewEpoch += 1
    readEpoch += 1
    readAbort?.abort()
  }
  return {
    state,
    readiness,
    models,
    conversations,
    conversationId,
    selectedModelId,
    pending,
    maxTokens,
    temperature,
    busy,
    nextCursor,
    loadMore,
    loadWorkspace,
    newConversation,
    clearConversation,
    deleteConversation,
    renameConversation,
    toggleConversationPin,
    openConversation,
    send,
    cancel,
    resetParameters,
    exportConversation,
    exportPending: exporting.pending,
    dispose,
    drafts,
    phase: stream.phase,
    attempt,
  }
}
function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : '聊天工作区请求失败'
}
