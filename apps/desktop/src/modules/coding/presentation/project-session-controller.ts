import { ref } from 'vue'
import type { CodingGateway, CodingSession } from '../application/ports'
interface Dependencies {
  gateway: Pick<CodingGateway, 'sessions'>
  alive(): boolean
  clearSession(): void
  guard<T>(action: () => Promise<T>, valid?: () => boolean): Promise<T | undefined>
  pending(): boolean
}
export function createProjectSessionController(deps: Dependencies) {
  const projectId = ref(''),
    sessions = ref<CodingSession[]>([]),
    sessionsHasMore = ref(false)
  let generation = 0,
    abort: AbortController | undefined
  async function selectProject(id: string): Promise<void> {
    const request = ++generation
    abort?.abort()
    abort = new AbortController()
    const valid = () => request === generation && projectId.value === id && deps.alive()
    if (projectId.value !== id) {
      deps.clearSession()
      sessions.value = []
      sessionsHasMore.value = false
    }
    projectId.value = id
    const signal = abort.signal
    await deps.guard(async () => {
      const result = await deps.gateway.sessions(id, signal)
      if (valid()) {
        sessions.value = result
        sessionsHasMore.value = result.length === 100
      }
    }, valid)
  }
  async function loadMoreSessions(): Promise<void> {
    if (!sessionsHasMore.value || deps.pending()) return
    const request = generation,
      id = projectId.value
    await deps.guard(async () => {
      const result = await deps.gateway.sessions(id, abort?.signal, sessions.value.at(-1)?.id)
      if (request !== generation || !deps.alive()) return
      const known = new Set(sessions.value.map((item) => item.id))
      sessions.value = [...sessions.value, ...result.filter((item) => !known.has(item.id))]
      sessionsHasMore.value = result.length === 100
    })
  }
  function dispose(): void {
    generation++
    abort?.abort()
  }
  return {
    projectId,
    sessions,
    sessionsHasMore,
    selectProject,
    loadMoreSessions,
    dispose,
    get generation() {
      return generation
    },
  }
}
