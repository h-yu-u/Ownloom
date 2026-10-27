import { deriveTaskReadiness } from '../../models'
import { computed, ref, type Ref } from 'vue'
import {
  RuntimeError,
  type AgentChatSnapshot,
  type AgentChatRequest,
  type AgentSession,
  type ExtensionSelection,
  type ModelSummary,
  type agentChatEndpoints,
} from '@mlx-studio/api-client'
import type { SubmitOutcome } from '../../../shared/lib/submit-outcome'
import {
  createAgentDraftMemory,
  copySelection,
  type AgentDraftMemory,
  type PendingAgentSubmission,
} from './agent-draft-memory'
import { projectAgentEvent } from './agent-observer'
import { extensionError } from './errors'
interface Dependencies {
  runtimeAvailable?(): boolean
  gateway: Omit<ReturnType<typeof agentChatEndpoints>, 'events'> &
    Partial<Pick<ReturnType<typeof agentChatEndpoints>, 'events'>>
  models: Readonly<Ref<readonly ModelSummary[]>>
  refreshModels(): Promise<void>
  verifyModel(id: string): Promise<unknown>
  memory?: AgentDraftMemory
}
export function createAgentController(deps: Dependencies) {
  const memory = deps.memory ?? createAgentDraftMemory()
  const sessions = ref<AgentSession[]>([]),
    sessionId = ref(memory.lastSessionId),
    modelId = ref('')
  const snapshot = ref<AgentChatSnapshot | null>(null),
    pending = ref(false),
    error = ref('')
  const key = computed(() =>
    sessionId.value ? `agent:session:${sessionId.value}` : memory.unboundKey,
  )
  const text = computed({
    get: () => {
      void memory.revision.value
      return memory.drafts.get(key.value).text
    },
    set: (value: string) => {
      memory.drafts.edit(key.value, value)
    },
  })
  const models = computed(() =>
    deps.models.value
      .filter((model) => model.outputModalities.includes('text'))
      .map((model) => ({ label: model.displayName, value: model.id })),
  )
  const active = computed(() =>
    snapshot.value?.runs.find((run) =>
      ['queued', 'starting', 'running', 'awaiting_approval', 'cancelling'].includes(run.status),
    ),
  )
  const recovery = computed(() => {
    void memory.revision.value
    return [...memory.submissions.values()].filter((ticket) => ticket.state === 'unknown')
  })
  let epoch = 0,
    disposed = false,
    watching: number | undefined
  let observation = new AbortController()
  const requests = new Set<symbol>()
  async function guard<T>(action: () => Promise<T>): Promise<T | undefined> {
    const owner = epoch,
      token = Symbol()
    requests.add(token)
    pending.value = true
    error.value = ''
    try {
      return await action()
    } catch (cause) {
      if (owner === epoch && !disposed) error.value = extensionError(cause)
    } finally {
      requests.delete(token)
      pending.value = requests.size > 0
    }
  }
  async function refresh(): Promise<void> {
    const owner = epoch,
      id = sessionId.value
    if (!id) return
    const value = await deps.gateway.snapshot(id)
    if (owner === epoch && !disposed && sessionId.value === id) snapshot.value = value
  }
  async function observe(): Promise<void> {
    if (watching === epoch || disposed) return
    const owner = epoch
    watching = owner
    try {
      while (owner === epoch && !disposed) {
        if (!deps.gateway.events) break
        const batch = await deps.gateway.events(snapshot.value?.watermark ?? 0, observation.signal)
        if (owner !== epoch || disposed || !snapshot.value) return
        for (const event of batch.events) snapshot.value = projectAgentEvent(snapshot.value, event)
      }
    } catch (cause) {
      if (owner === epoch && !disposed) error.value = `状态同步中断：${extensionError(cause)}`
    } finally {
      if (watching === owner) watching = undefined
    }
  }
  async function createSession(): Promise<string | undefined> {
    if (memory.createUncertain) {
      error.value = '上次创建结果未知，请刷新会话列表并选择目标，避免重复创建'
      return
    }
    const owner = epoch,
      draft = memory.drafts.get(key.value)
    let session: AgentSession
    try {
      session = await deps.gateway.create()
    } catch (cause) {
      memory.createUncertain =
        !(cause instanceof RuntimeError) || cause.status === 0 || cause.status >= 500
      memory.createReviewed = false
      memory.revision.value++
      throw cause
    }
    sessions.value = [session, ...sessions.value.filter((item) => item.id !== session.id)]
    const bound = memory.drafts.bind(draft, `agent:session:${session.id}`)
    if (owner === epoch && !disposed) {
      sessionId.value = session.id
      memory.lastSessionId = session.id
      memory.unboundKey = `agent:new:${crypto.randomUUID()}`
      if (bound !== 'bound') error.value = '会话已创建，原草稿保留，请选择原草稿后重试'
    }
    return session.id
  }
  async function commit(ticket: PendingAgentSubmission): Promise<SubmitOutcome> {
    const owner = epoch,
      { request, targetSessionId, draft } = ticket
    ticket.state = 'submitting'
    memory.revision.value++
    try {
      const run = await deps.gateway.submit(targetSessionId, request)
      memory.drafts.consume(draft)
      memory.submissions.delete(request.submissionId)
      memory.revision.value++
      let syncWarning: string | undefined
      if (owner === epoch && !disposed && targetSessionId === sessionId.value) {
        try {
          await refresh()
          void observe()
        } catch (cause) {
          syncWarning = `任务已接纳，状态同步失败：${extensionError(cause)}`
          error.value = syncWarning
        }
      }
      return {
        kind: 'accepted',
        runId: run.id,
        submissionId: request.submissionId,
        targetSessionId,
        syncWarning,
      }
    } catch (cause) {
      const message = extensionError(cause)
      // Any ambiguous transport failure retains the exact public POST for explicit recovery.
      if (!(cause instanceof RuntimeError) || cause.status === 0 || cause.status >= 500) {
        ticket.state = 'unknown'
        memory.revision.value++
        if (owner === epoch && !disposed) error.value = '提交结果未知，请恢复这次提交；原草稿已保留'
        return {
          kind: 'failed',
          acceptance: 'unknown',
          submissionId: request.submissionId,
          targetSessionId,
          message,
        }
      }
      memory.submissions.delete(request.submissionId)
      memory.revision.value++
      if (owner === epoch && !disposed) error.value = message
      return { kind: 'failed', acceptance: 'not-accepted', message }
    }
  }
  async function send(
    selection: ExtensionSelection,
    handoff?: AgentChatRequest['handoff'],
  ): Promise<SubmitOutcome> {
    if (
      !deriveTaskReadiness(
        deps.models.value.find((model) => model.id === modelId.value),
        { available: deps.runtimeAvailable?.() ?? true },
        { output: 'text', tools: true },
        { allowTrial: true },
      ).submitAllowed
    )
      return { kind: 'blocked', reason: '请选择兼容的本地模型' }
    if (active.value || pending.value || !text.value.trim() || !modelId.value)
      return { kind: 'blocked', reason: '请选择模型并等待当前任务结束' }
    const initialTarget = sessionId.value,
      initialOwner = epoch
    const draft = memory.drafts.get(key.value),
      selectedModel = modelId.value,
      selected = copySelection(selection)
    if ([...memory.submissions.values()].some((ticket) => ticket.draft.id === draft.id))
      return { kind: 'blocked', reason: '请先恢复结果未知的提交' }
    let outcome: SubmitOutcome = { kind: 'blocked', reason: '未能创建会话或准备模型' }
    await guard(async () => {
      await deps.verifyModel(selectedModel)
      if (initialOwner !== epoch || disposed) return
      const target = initialTarget || (await createSession())
      if (!target) return
      const request = {
        submissionId: crypto.randomUUID(),
        text: draft.text,
        modelId: selectedModel,
        mode: 'develop' as const,
        selection: selected,
        ...(handoff ? { handoff } : {}),
      }
      const ticket: PendingAgentSubmission = {
        targetSessionId: target,
        draft,
        request,
        state: 'submitting',
      }
      memory.submissions.set(request.submissionId, ticket)
      memory.revision.value++
      outcome = await commit(ticket)
    })
    return outcome
  }
  async function reviewCreation(): Promise<void> {
    await guard(async () => {
      const owner = epoch,
        items = await deps.gateway.sessions()
      if (owner !== epoch || disposed) return
      sessions.value = items
      memory.createReviewed = true
      memory.revision.value++
      error.value = '已重新读取会话。请选择已有会话，或再次点击新建以创建一份新会话。原输入已保留。'
    })
  }
  return {
    creationUncertain: computed(() => {
      void memory.revision.value
      return memory.createUncertain
    }),
    reviewCreation,
    sessions,
    sessionId,
    modelId,
    snapshot,
    pending,
    error,
    text,
    models,
    active,
    recovery,
    send,
    async recover(id: string) {
      const ticket = memory.submissions.get(id)
      if (ticket && ticket.state === 'unknown' && !pending.value) await guard(() => commit(ticket))
    },
    async load() {
      if (observation.signal.aborted) observation = new AbortController()
      disposed = false
      await guard(async () => {
        const owner = epoch
        await deps.refreshModels()
        const items = await deps.gateway.sessions()
        if (owner !== epoch || disposed) return
        sessions.value = items
        if (!modelId.value) modelId.value = models.value[0]?.value ?? ''
        if (sessionId.value && !items.some((item) => item.id === sessionId.value)) {
          const original = memory.drafts.get(`agent:session:${sessionId.value}`)
          memory.drafts.bind(original, memory.unboundKey)
          sessionId.value = ''
          memory.lastSessionId = ''
          error.value = '原会话已不可用，草稿保留，请选择目标会话'
        }
        await refresh()
        void observe()
      })
    },
    async open(id: string) {
      observation.abort()
      observation = new AbortController()
      epoch++
      disposed = false
      if (!sessionId.value && memory.drafts.get(memory.unboundKey).text)
        memory.drafts.bind(memory.drafts.get(memory.unboundKey), `agent:session:${id}`)
      sessionId.value = id
      memory.lastSessionId = id
      memory.createUncertain = false
      memory.revision.value++
      snapshot.value = null
      await guard(refresh)
      void observe()
    },
    async create() {
      if (memory.createUncertain && !memory.createReviewed) {
        await reviewCreation()
        return
      }
      if (!pending.value) {
        memory.createUncertain = false
        memory.createReviewed = false
        memory.revision.value++
        sessionId.value = ''
        memory.lastSessionId = ''
        await guard(async () => {
          const id = await createSession()
          if (id) await refresh()
        })
      }
    },
    async cancel() {
      const run = active.value
      if (run && run.status !== 'cancelling' && !pending.value)
        await guard(async () => {
          await deps.gateway.cancel(run.id)
          await refresh()
        })
    },
    async resolve(id: string, allowed: boolean) {
      await guard(async () => {
        await deps.gateway.resolve(id, allowed)
        await refresh()
      })
    },
    dispose() {
      observation.abort()
      epoch++
      disposed = true
      watching = undefined
    },
  }
}
