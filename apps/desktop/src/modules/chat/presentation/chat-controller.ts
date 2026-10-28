import { deriveTaskReadiness } from '../../../capabilities/models'
import { RequestScope } from '../../../capabilities/requests'
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
import { initialChatState, type ChatState } from '../domain/chat-state'
import type { ChatGateway } from '../application/ports'
import { createChatStream } from './chat-stream-controller'
import type { createChatDraftController } from './chat-draft-controller'
import { createChatAttempts } from './chat-attempts'
import { projectConversation, projectSubmission } from './chat-projection'

interface ChatDependencies {
  gateway: ChatGateway
  draftFactory?: (
    conversationId: Ref<string | null>,
  ) => ReturnType<typeof createChatDraftController>
  runtimeAvailable?(): boolean
  models: Readonly<Ref<readonly ModelSummary[]>>
  refreshModels(): Promise<void>
  exportText(content: string, filename: string, signal?: AbortSignal): Promise<FileExportResult>
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
  const navigating = ref(false)
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
  const view = new RequestScope()
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
    navigating,
    view,
    refresh: loadWorkspace,
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
    state.value = projectConversation(state.value, item)
  }
  async function openConversation(id: string): Promise<void> {
    if (pending.value) return
    stream.dispose()
    const epoch = ++readEpoch
    const owner = view.owner
    navigating.value = true
    readAbort?.abort()
    readAbort = new AbortController()
    try {
      const item = await deps.gateway.get(id, readAbort.signal)
      if (epoch === readEpoch && view.owns(owner)) {
        present(item)
        await stream.resume()
      }
    } catch (cause) {
      if (epoch === readEpoch && view.owns(owner)) await stream.resume()
      throw cause
    } finally {
      if (epoch === readEpoch) navigating.value = false
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
    view.reset()
    const owner = view.owner
    if (pending.value) return
    navigating.value = true
    try {
      if (busy.value && state.value.activeJobId) {
        await stream.resume()
        return
      }
      await stream.resume()
      if (!view.owns(owner)) return
      state.value = { ...state.value, status: 'loading', error: null }
      const [, items] = await Promise.all([deps.refreshModels(), deps.gateway.list()])
      if (!view.owns(owner)) return
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
      if (view.owns(owner))
        state.value = { ...state.value, status: 'error', error: errorText(cause) }
    } finally {
      if (view.owns(owner)) navigating.value = false
    }
  }
  async function newConversation(): Promise<void> {
    if (pending.value || navigating.value) return
    stream.dispose()
    pending.value = true
    try {
      const item = await deps.gateway.create(selectedModelId.value)
      readEpoch += 1
      present(item)
      conversations.value = [item, ...conversations.value]
    } finally {
      pending.value = false
      if (view.owns(view.owner)) await stream.resume()
    }
  }
  async function deleteConversation(id: string): Promise<void> {
    if (busy.value || pending.value || navigating.value) return
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
    if (busy.value || pending.value || navigating.value) return
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
  async function submissionConversation(modelId: string, owner: number): Promise<string> {
    if (conversationId.value) return conversationId.value
    const item = await deps.gateway.create(modelId)
    drafts?.bind(item.id)
    conversationId.value = item.id
    conversations.value = [item, ...conversations.value]
    if (view.owns(owner)) {
      present(item)
      await stream.resume()
    }
    return item.id
  }
  async function send(
    content: string,
    files: File[] = [],
    selection?: ExtensionSelection,
  ): Promise<boolean> {
    if (!view.owns(view.owner) || navigating.value || !readiness.value.submitAllowed) return false
    const draft = drafts?.draft.value.text === content ? drafts.draft.value : undefined
    if (
      (!content.trim() && !files.length && !draft?.attachments.length) ||
      busy.value ||
      pending.value
    )
      return false
    pending.value = true
    const owner = view.owner
    const parameters = {
      modelId: selectedModelId.value,
      maxTokens: maxTokens.value,
      temperature: temperature.value,
    }
    try {
      const target = await submissionConversation(parameters.modelId, owner)
      const result = await submission.run({
        conversationId: target,
        content,
        files,
        attachments: files.length ? undefined : submissionAttachments(draft),
        draftIdentity: draft ? `${draft.id}:${draft.revision}` : undefined,
        webSearch: { enabled: draft?.webSearchEnabled ?? false },
        webSearchProvider: draft?.webSearchEnabled ? deps.gateway.webSearch : undefined,
        visualSelection: draft?.visualSelection,
        selection,
        ...parameters,
      })
      if (!result) return false
      if (draft) drafts?.consume(draft.key, draft.revision)
      if (!view.owns(owner) || target !== conversationId.value) return true
      state.value = projectSubmission(state.value, {
        ...result,
        messageId: result.userMessageId ?? crypto.randomUUID(),
      })
      stream.start(result.jobId, result.after)
      return true
    } finally {
      pending.value = false
      if (!view.owns(owner) && view.owns(view.owner)) void loadWorkspace()
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
      write: (_blob, signal) => deps.exportText(content, 'ownloom-conversation.md', signal),
    })
  }
  function dispose(): void {
    exporting.invalidate()
    stream.dispose()
    drafts?.disposePreview()
    view.dispose()
    navigating.value = false
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
    pending: computed(() => pending.value || navigating.value),
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
