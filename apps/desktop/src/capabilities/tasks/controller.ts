import { computed, ref } from 'vue'
import { RuntimeError, type TaskSummary } from '@mlx-studio/api-client'
import { groupTasks } from './task-groups'
export function createTaskCenter(deps: {
  refreshModels?(): Promise<void>
  tasks(signal: AbortSignal): Promise<TaskSummary[]>
  download(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<unknown>
}) {
  const items = ref<TaskSummary[]>([]),
    error = ref(''),
    loading = ref(false),
    loaded = ref(false)
  const groups = computed(() => groupTasks(items.value))
  const active = computed(() => groups.value.filter((item) => item.active))
  const approvals = computed(() => groups.value.filter((item) => item.needsApproval))
  let abort: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let flight: Promise<void> | undefined
  let modelsDirty = false
  async function load(owner: AbortController): Promise<void> {
    try {
      const next = await deps.tasks(owner.signal)
      if (abort !== owner || owner.signal.aborted) return
      modelsDirty ||= next.some(
        (item) =>
          item.owner === 'download' &&
          item.state === 'available' &&
          !items.value.some((old) => old.id === item.id && old.state === 'available'),
      )
      items.value = next
      loaded.value = true
      error.value = ''
    } catch (cause) {
      if (abort === owner && !owner.signal.aborted)
        error.value =
          cause instanceof RuntimeError
            ? `任务列表加载失败：${cause.message}`
            : '暂时无法读取任务列表，请重试。'
      return
    }
    if (modelsDirty) {
      try {
        await deps.refreshModels?.()
        if (abort === owner) modelsDirty = false
      } catch {
        if (abort === owner && !owner.signal.aborted)
          error.value = '任务列表已更新，但模型列表刷新失败，请重试。'
      }
    }
  }
  function refresh(): Promise<void> {
    clearTimeout(timer)
    if (flight) return flight
    const owner = abort
    if (!owner) return Promise.resolve()
    loading.value = true
    flight = load(owner).finally(() => {
      if (abort !== owner || owner.signal.aborted) return
      loading.value = false
      flight = undefined
      timer = setTimeout(refresh, active.value.length ? 2000 : 5000)
    })
    return flight
  }
  return {
    items,
    groups,
    error,
    loading,
    loaded,
    active,
    approvals,
    refresh,
    start() {
      if (!abort) {
        abort = new AbortController()
        void refresh()
      }
    },
    stop() {
      abort?.abort()
      abort = undefined
      flight = undefined
      loading.value = false
      clearTimeout(timer)
    },
    async download(id: string, action: 'pause' | 'resume' | 'cancel') {
      try {
        await deps.download(id, action)
        clearTimeout(timer)
        await refresh()
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '下载操作失败'
      }
    },
  }
}
