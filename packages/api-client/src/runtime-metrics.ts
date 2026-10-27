import type { components } from './generated-schema'
import { malformed, number, record } from './decoders'

export type RuntimeMetrics = components['schemas']['RuntimeMetrics']

function nonNegative(value: unknown): number {
  const parsed = number(value)
  if (parsed < 0) throw malformed()
  return parsed
}

function optionalCounter(value: unknown): number | null {
  return value === null || value === undefined ? null : nonNegative(value)
}

export function decodeRuntimeMetrics(value: unknown): RuntimeMetrics {
  const item = record(value)
  const result: RuntimeMetrics = {
    uptime_seconds: nonNegative(item.uptime_seconds),
    process_max_rss_bytes: nonNegative(item.process_max_rss_bytes),
    disk_free_bytes: nonNegative(item.disk_free_bytes),
    worker_restarts: nonNegative(item.worker_restarts),
    active_jobs: nonNegative(item.active_jobs),
    // Older binaries can still serve the original metrics, without claiming zero system usage.
    system_memory_total_bytes: optionalCounter(item.system_memory_total_bytes),
    system_memory_used_bytes: optionalCounter(item.system_memory_used_bytes),
    system_memory_available_bytes: optionalCounter(item.system_memory_available_bytes),
    system_memory_used_percent: optionalCounter(item.system_memory_used_percent),
    worker_memory_bytes: optionalCounter(item.worker_memory_bytes),
  }
  const total = result.system_memory_total_bytes
  if (
    (total !== null && total <= 0) ||
    (total !== null &&
      result.system_memory_used_bytes !== null &&
      result.system_memory_used_bytes > total) ||
    (total !== null &&
      result.system_memory_available_bytes !== null &&
      result.system_memory_available_bytes > total) ||
    (result.system_memory_used_percent !== null && result.system_memory_used_percent > 100)
  )
    throw malformed()
  return result
}
