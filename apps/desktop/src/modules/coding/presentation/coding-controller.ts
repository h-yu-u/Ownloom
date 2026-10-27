import { deriveTaskReadiness } from '../../../capabilities/models'
import type { CodingControllerDependencies } from './coding-controller-ports'
import { createCodingSubmission } from './coding-submission'
import { createCodingPermissions } from './coding-permissions'
import { createProjectSessionController } from './project-session-controller'
import { projectCodingEvent } from './event-projection'
import { decodeCodingProjection } from '@mlx-studio/api-client'
import { createCodingInspector } from './coding-inspector-controller'
import { codingErrorText } from './coding-errors'
import { modelNeedsVerification } from '../application/submit-coding-run'
import { ensureModelCapability } from '../application/ensure-model-capability'
import { computed, ref } from 'vue'
import type { CodingSessionPatch } from '@mlx-studio/api-client'
import type {
  CodingProject,
  CodingSession,
  CodingSnapshot,
  CodingCapability,
  CodingEvent,
} from '../application/ports'
import { activeStatus, isVerified, type CodingMode } from '../domain/status'
export function createCodingController(deps: CodingControllerDependencies) {
  const projects = ref<CodingProject[]>([]),
    snapshot = ref<CodingSnapshot | null>(null)
  const capabilities = ref<CodingCapability[]>([]),
    selectedModelId = ref(''),
    sessionId = ref('')
  const mode = ref<CodingMode>('develop'),
    pending = ref(false),
    error = ref<string | null>(null)
  const preparingModel = ref(false)
  const models = computed(() =>
    deps.models.value
      .filter((model) => model.outputModalities.includes('text'))
      .map((model) => ({ label: model.displayName, value: model.id })),
  )
  const active = computed(() => snapshot.value?.activeRun ?? null)
  const busy = computed(() => !!active.value && activeStatus(active.value.status))
  const readiness = computed(() =>
    deriveTaskReadiness(
      deps.models.value.find((model) => model.id === selectedModelId.value),
      { available: deps.runtimeAvailable?.() ?? true, busy: busy.value },
      { output: 'text', tools: true },
      { toolsVerified: isVerified(capabilities.value, selectedModelId.value), allowTrial: true },
    ),
  )
  const projectSelection = createProjectSessionController({
    gateway: deps.gateway,
    guard,
    alive: () => !disposed,
    pending: () => pending.value,
    clearSession: () => {
      epoch++
      release?.()
      release = undefined
      sessionId.value = ''
      snapshot.value = null
      inspector.resetInspector()
    },
  })
  const { projectId, sessions, sessionsHasMore, selectProject, loadMoreSessions } = projectSelection
  const inspector = createCodingInspector({
    gateway: deps.gateway,
    sessionId,
    busy,
    onRestored: refresh,
  })
  const permissions = createCodingPermissions({
    gateway: deps.gateway,
    sessionId,
    active,
    pending,
    guard,
    refresh,
  })
  const submission = createCodingSubmission({
    gateway: deps.gateway,
    projectId,
    sessionId,
    selectedModelId,
    mode,
    permissionMode: permissions.mode,
    pending,
    busy,
    canSubmit: () => !snapshot.value?.session.archived && readiness.value.submitAllowed,
    canSteer: () =>
      !!active.value &&
      active.value.sessionId === sessionId.value &&
      ['running', 'awaiting_approval'].includes(active.value.status),
    error,
    guard,
    ensure: prepareModel,
    refresh,
    invalidate: (id) => {
      capabilities.value = capabilities.value.filter((item) => item.id !== id)
    },
    owner: () => epoch,
    owns: (owner) => owner === epoch && !disposed,
  })
  submission.setActiveRun(() => active.value?.id ?? '')
  const pendingRequests = new Set<symbol>()
  let disposed = false
  let epoch = 0,
    release: (() => void) | undefined
  async function guard<T>(action: () => Promise<T>, valid?: () => boolean): Promise<T | undefined> {
    const owner = epoch
    const request = Symbol()
    pendingRequests.add(request)
    pending.value = true
    error.value = null
    try {
      return await action()
    } catch (cause) {
      if (owner !== epoch || disposed || valid?.() === false) return undefined
      error.value = codingErrorText(cause)
      if (modelNeedsVerification(cause))
        capabilities.value = capabilities.value.filter((item) => item.id !== selectedModelId.value)
      return undefined
    } finally {
      pendingRequests.delete(request)
      pending.value = pendingRequests.size > 0
    }
  }
  async function refresh(): Promise<number> {
    const owner = epoch,
      id = sessionId.value
    if (!id) return 0
    const result = await deps.gateway.snapshot(id)
    if (owner !== epoch || id !== sessionId.value) return result.watermark
    const previous = snapshot.value?.watermark ?? result.watermark
    snapshot.value = result
    sessions.value = sessions.value.map((item) =>
      item.id === result.session.id ? result.session : item,
    )
    if (
      result.events.some(
        (event) =>
          event.seq > previous && ['file.changed', 'verification.finished'].includes(event.type),
      )
    )
      void inspector.refreshInspector()
    error.value = null
    return result.watermark
  }
  function applyEvent(event: CodingEvent): boolean {
    if (!snapshot.value || disposed) return false
    try {
      const next = projectCodingEvent(snapshot.value, event, decodeCodingProjection(event.data))
      if (!next) return false
      snapshot.value = next
      if (
        event.sessionId === sessionId.value &&
        ['file.changed', 'file.restored'].includes(event.type)
      )
        void inspector.refreshInspector()
      return true
    } catch {
      return false
    }
  }
  async function openSession(id: string): Promise<void> {
    const owner = ++epoch
    release?.()
    release = undefined
    sessionId.value = id
    snapshot.value = null
    inspector.resetInspector()
    await guard(async () => {
      const after = await refresh()
      if (owner !== epoch || disposed || sessionId.value !== id) return
      release = deps.observe(
        after,
        refresh,
        (cause) => {
          if (owner !== epoch || disposed) return
          error.value = cause instanceof Error ? cause.message : '正在重新连接 Coding'
        },
        (event) => owner === epoch && !disposed && applyEvent(event),
      )
    })
  }
  async function loadWorkspace(routeProject?: string, routeSession?: string): Promise<void> {
    disposed = false
    const owner = ++epoch
    release?.()
    release = undefined
    await guard(async () => {
      const [items, caps, settings] = await Promise.all([
        deps.gateway.projects(),
        deps.gateway.capabilities(),
        deps.gateway.settings(),
        deps.refreshModels(),
      ])
      if (owner !== epoch || disposed) return
      projects.value = items
      capabilities.value = caps
      if (!selectedModelId.value)
        selectedModelId.value =
          settings.defaultModelId ||
          (caps.find((item) => item.status === 'verified')?.id ?? models.value[0]?.value ?? '')
    })
    if (owner !== epoch || disposed) return
    const target = routeProject ?? (projectId.value || projects.value[0]?.id)
    const selection = projectSelection.generation + 1
    const selectionEpoch = epoch + (target && target !== projectId.value ? 1 : 0)
    if (target) await selectProject(target)
    if (
      disposed ||
      epoch !== selectionEpoch ||
      (target && selection !== projectSelection.generation)
    )
      return
    if (routeSession) await openSession(routeSession)
    else if (sessionId.value) await openSession(sessionId.value)
  }
  async function openProject(): Promise<void> {
    await guard(async () => {
      const path = await deps.pickDirectory()
      if (!path) return
      const project = await deps.gateway.register(path)
      projects.value = [...projects.value.filter((item) => item.id !== project.id), project]
      await selectProject(project.id)
    })
  }
  async function newSession(): Promise<CodingSession | undefined> {
    if (!projectId.value) return
    const owner = epoch,
      project = projectId.value
    const session = await guard(() => deps.gateway.create(project))
    if (!session || owner !== epoch || disposed || project !== projectId.value) return
    sessions.value = [session, ...sessions.value]
    await openSession(session.id)
    return session
  }
  async function updateSession(id: string, patch: CodingSessionPatch): Promise<void> {
    await guard(async () => {
      const updated = await deps.gateway.update(id, patch)
      sessions.value = sessions.value.map((item) => (item.id === id ? updated : item))
      if (sessionId.value === id) await refresh()
    })
  }
  async function removeSession(id: string): Promise<void> {
    await guard(async () => {
      await deps.gateway.remove(id)
      submission.drafts.discard(`coding:project:${projectId.value}:session:${id}`)
      sessions.value = sessions.value.filter((item) => item.id !== id)
      if (sessionId.value === id) {
        epoch++
        release?.()
        sessionId.value = ''
        snapshot.value = null
        inspector.resetInspector()
      }
    })
  }
  async function cancel(): Promise<void> {
    if (active.value)
      await guard(async () => {
        await deps.gateway.cancel(active.value!.id)
        await refresh()
      })
  }
  async function resolve(id: string, allowed: boolean): Promise<void> {
    await guard(async () => {
      await deps.gateway.resolve(id, allowed)
      await refresh()
    })
  }
  async function cancelActive(): Promise<void> {
    try {
      await deps.gateway.cancelActive()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '停止失败'
    }
  }
  async function prepareModel(id: string, force = false): Promise<void> {
    await ensureModelCapability(
      id,
      {
        gateway: deps.gateway,
        capabilities: () => capabilities.value,
        update: (result) => {
          capabilities.value = [
            ...capabilities.value.filter((item) => item.id !== result.id),
            result,
          ]
        },
        preparing: (value) => {
          preparingModel.value = value
        },
      },
      force,
    )
  }
  async function verifyModel(): Promise<void> {
    await guard(() => prepareModel(selectedModelId.value, true))
  }
  function dispose(): void {
    disposed = true
    projectSelection.dispose()
    pendingRequests.clear()
    pending.value = false
    epoch++
    release?.()
    release = undefined
    inspector.resetInspector()
  }
  return {
    projects,
    sessions,
    snapshot,
    capabilities,
    selectedModelId,
    projectId,
    sessionId,
    mode,
    permissionMode: permissions.mode,
    setPermissions: permissions.change,
    pending,
    error,
    preparingModel,
    ...inspector,
    models,
    readiness,
    modelReady: computed(() => isVerified(capabilities.value, selectedModelId.value)),
    active,
    busy,
    loadWorkspace,
    openProject,
    selectProject,
    sessionsHasMore,
    loadMoreSessions,
    openSession,
    newSession,
    updateSession,
    removeSession,
    verifyAfter: submission.verifyAfter,
    send: submission.send,
    draftText: submission.text,
    cancel,
    steer: submission.steer,
    resolve,
    verifyModel,
    cancelActive,
    dispose,
  }
}
