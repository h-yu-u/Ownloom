import { createExportOperation } from '../../shared/lib/export-operation'
import type { FileExportResult } from '../../shared/lib/file-export'
import { computed, ref } from 'vue'
import type { RuntimeMetrics } from '@mlx-studio/api-client'
interface RuntimeOverviewDependencies {
  gateway: ReturnType<typeof import('./gateway').createRuntimeGateway>
  exportFile(blob: Blob, filename: string): Promise<FileExportResult>
}
export function createRuntimeController(deps: RuntimeOverviewDependencies) {
  const info = ref<Record<string, unknown>>({})
  const metrics = ref<RuntimeMetrics | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  let refreshing = false
  const diskFree = computed(() => formatBytes(metrics.value?.disk_free_bytes))
  const memory = computed(() => formatBytes(metrics.value?.process_max_rss_bytes))
  const systemMemory = computed(() => {
    const total = metrics.value?.system_memory_total_bytes
    const used = metrics.value?.system_memory_used_bytes
    if (total == null || used == null) return '—'
    return `${(used / 1024 ** 3).toFixed(1)} / ${(total / 1024 ** 3).toFixed(1)} GB`
  })
  const memoryPercent = computed(() => metrics.value?.system_memory_used_percent ?? null)
  const workerMemory = computed(() =>
    metrics.value?.worker_memory_bytes === 0
      ? '未启动'
      : formatBytes(metrics.value?.worker_memory_bytes),
  )
  const uptime = computed(() =>
    typeof metrics.value?.uptime_seconds === 'number'
      ? `${metrics.value.uptime_seconds.toFixed(1)} 秒`
      : '—',
  )

  async function load(background: boolean): Promise<void> {
    if (refreshing) return
    refreshing = true
    loading.value = !background
    try {
      const [nextInfo, nextMetrics] = await Promise.all([
        deps.gateway.info(),
        deps.gateway.metrics(),
      ])
      info.value = toRecord(nextInfo)
      metrics.value = nextMetrics
      error.value = null
    } catch (cause) {
      info.value = {}
      metrics.value = null
      error.value = cause instanceof Error ? cause.message : '无法读取 Runtime 状态'
    } finally {
      loading.value = false
      refreshing = false
    }
  }

  function refresh(): Promise<void> {
    return load(false)
  }
  function poll(): Promise<void> {
    return load(true)
  }

  async function restart(): Promise<void> {
    await deps.gateway.restart()
    await refresh()
  }
  const exporting = createExportOperation()
  async function downloadDiagnostics() {
    return exporting.run({
      id: 'diagnostics',
      read: deps.gateway.diagnostics,
      write: (blob) => deps.exportFile(blob, 'ownloom-diagnostics.zip'),
    })
  }
  return {
    info,
    metrics,
    error,
    loading,
    diskFree,
    memory,
    systemMemory,
    memoryPercent,
    workerMemory,
    uptime,
    refresh,
    poll,
    restart,
    downloadDiagnostics,
    exportPending: exporting.pending,
    dispose: exporting.invalidate,
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}
