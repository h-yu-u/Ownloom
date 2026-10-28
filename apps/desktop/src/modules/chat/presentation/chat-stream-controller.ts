import { ref, type Ref } from 'vue'
import { decodeSource, type Conversation, type RuntimeEvent } from '@mlx-studio/api-client'
import type { ChatGateway } from '../application/ports'
import { reduceChatState, type ChatState } from '../domain/chat-state'
import { createDeltaBuffer } from './delta-buffer'
import { chatError } from '../domain/chat-error'

export interface ChatStreamDependencies {
  gateway: ChatGateway
  state: Ref<ChatState>
  conversationId: Ref<string | null>
  present(item: Conversation, selectModel?: boolean): void
  refresh(items: Conversation[]): void
  observe(
    id: string,
    after: number,
    event: (event: RuntimeEvent) => void,
    resync: () => Promise<number | void>,
  ): () => void
}
export function createChatStream(deps: ChatStreamDependencies) {
  const phase = ref('')
  let release: (() => void) | undefined,
    epoch = 0,
    active = true,
    textRevision = 0
  let projectionVersion = 0,
    instanceId = ''
  const deltas = createDeltaBuffer((jobId, text) => {
    deps.state.value = reduceChatState(deps.state.value, { type: 'generation.delta', jobId, text })
  })
  async function reconcile(): Promise<number | void> {
    deltas.flush()
    const owner = epoch,
      id = deps.conversationId.value,
      jobId = deps.state.value.activeJobId
    if (!id) return
    if (jobId) {
      const requestedTextRevision = textRevision,
        requestedProjectionVersion = projectionVersion
      const snapshot = await deps.gateway.job(jobId)
      if (
        owner !== epoch ||
        !active ||
        id !== deps.conversationId.value ||
        jobId !== deps.state.value.activeJobId ||
        snapshot.id !== jobId
      )
        return
      const terminal = ['succeeded', 'failed', 'cancelled'].includes(snapshot.state)
      const sameInstance = !instanceId || instanceId === snapshot.instance_id
      if (
        !terminal &&
        sameInstance &&
        ((snapshot.textRevision ?? requestedTextRevision) < textRevision ||
          (snapshot.projectionVersion ?? requestedProjectionVersion) < projectionVersion)
      )
        return
      deltas.flush()
      instanceId = snapshot.instance_id
      textRevision = snapshot.textRevision ?? (sameInstance ? requestedTextRevision : 0)
      projectionVersion =
        snapshot.projectionVersion ?? (sameInstance ? requestedProjectionVersion : 0)
      phase.value = snapshot.phase ?? ''
      deps.state.value = {
        ...deps.state.value,
        messages: deps.state.value.messages.map((item) =>
          item.id === jobId
            ? { ...item, content: snapshot.text, sources: snapshot.sources ?? [] }
            : item,
        ),
      }
      if (terminal)
        applyEvent(
          {
            type: `job.${snapshot.state}`,
            seq: snapshot.event_sequence,
            payload: { job_id: jobId, error_code: snapshot.errorCode ?? undefined },
          },
          false,
        )
      if (snapshot.state === 'succeeded') await reconcile()
      return snapshot.event_sequence
    }
    const [items, item] = await Promise.all([deps.gateway.list(), deps.gateway.get(id)])
    if (owner !== epoch || !active || id !== deps.conversationId.value) return
    deps.refresh(items)
    deps.present(item, false)
  }
  function applyEvent(event: RuntimeEvent, restore = true): void {
    const id = event.payload.job_id
    if (!active || typeof id !== 'string' || id !== deps.state.value.activeJobId) return
    if (event.type === 'job.phase_changed') {
      const version = event.payload.projectionVersion
      if (typeof version === 'number') {
        if (version <= projectionVersion) return
        projectionVersion = version
      }
      phase.value = String(event.payload.phase ?? '')
      return
    }
    if (event.type === 'chat.sources_ready') {
      applySources(id, event.payload.sources)
      return
    }
    if (event.type === 'generation.delta') {
      const revision = event.payload.textRevision
      if (typeof revision === 'number') {
        if (revision <= textRevision) return
        if (revision !== textRevision + 1) {
          void reconcile().catch(failed)
          return
        }
        textRevision = revision
      }
      deltas.push(id, String(event.payload.text ?? ''))
      return
    }
    const terminal =
      event.type === 'job.succeeded'
        ? {
            type: 'generation.completed' as const,
            finishReason:
              event.payload.finish_reason === 'length' ? ('length' as const) : undefined,
          }
        : event.type === 'job.cancelled'
          ? { type: 'generation.cancelled' as const }
          : event.type === 'job.failed'
            ? {
                type: 'generation.failed' as const,
                code: String(event.payload.error_code ?? 'INFERENCE_FAILED'),
                message: chatError(event.payload.error_code),
              }
            : undefined
    if (!terminal) return
    deltas.flush()
    deps.state.value = reduceChatState(deps.state.value, { ...terminal, jobId: id })
    release?.()
    release = undefined
    if (event.type === 'job.succeeded' && restore) void reconcile().catch(failed)
  }
  function applySources(id: string, value: unknown): void {
    try {
      if (!Array.isArray(value)) throw new Error('Invalid source map')
      const sources = value.map(decodeSource)
      deps.state.value = {
        ...deps.state.value,
        messages: deps.state.value.messages.map((item) =>
          item.id === id ? { ...item, sources } : item,
        ),
      }
    } catch {
      void reconcile().catch(failed)
    }
  }
  function failed(cause: unknown): void {
    deps.state.value.error = cause instanceof Error ? cause.message : '聊天恢复失败'
  }
  function start(id: string, after: number): void {
    if (!active) return
    release?.()
    textRevision = 0
    projectionVersion = 0
    instanceId = ''
    phase.value = 'accepted'
    if (active) release = deps.observe(id, after, applyEvent, reconcile)
    const owner = epoch
    void deps.gateway
      .list()
      .then((items) => {
        if (active && owner === epoch) deps.refresh(items)
      })
      .catch((cause: unknown) => {
        if (active && owner === epoch) failed(cause)
      })
  }
  async function resume(): Promise<void> {
    active = true
    const owner = ++epoch,
      id = deps.state.value.activeJobId
    if (!id) return
    try {
      const sequence = await reconcile()
      if (
        owner === epoch &&
        active &&
        id === deps.state.value.activeJobId &&
        sequence !== undefined
      ) {
        release?.()
        release = deps.observe(id, sequence, applyEvent, reconcile)
      }
    } catch (cause) {
      if (owner === epoch) failed(cause)
    }
  }
  function dispose(): void {
    deltas.flush()
    active = false
    epoch++
    release?.()
    release = undefined
  }
  return { phase, start, resume, dispose, reconcile }
}
