import { describe, expect, it, vi } from 'vitest'
import type { RuntimeMetrics } from '@mlx-studio/api-client'
import { createRuntimeController } from './controller'

const sample: RuntimeMetrics = {
  uptime_seconds: 1,
  disk_free_bytes: 1024 ** 3 * 500,
  process_max_rss_bytes: 1024 ** 2 * 60,
  worker_restarts: 0,
  active_jobs: 0,
  system_memory_total_bytes: 1024 ** 3 * 64,
  system_memory_used_bytes: 1024 ** 3 * 32,
  system_memory_available_bytes: 1024 ** 3 * 32,
  system_memory_used_percent: 50,
  worker_memory_bytes: 1024 ** 3 * 20,
}
function setup(metrics = vi.fn(async () => sample)) {
  const gateway = {
    metrics,
    info: vi.fn(async () => ({})),
    restart: vi.fn(),
    diagnostics: vi.fn(),
  }
  return { gateway, controller: createRuntimeController({ gateway, exportFile: vi.fn() }) }
}
describe('live resource overview', () => {
  it('shows whole-machine usage and current Worker memory, independently of peak RSS', async () => {
    const { controller } = setup()
    await controller.poll()
    expect(controller.systemMemory.value).toBe('32.0 / 64.0 GB')
    expect(controller.memoryPercent.value).toBe(50)
    expect(controller.workerMemory.value).toBe('20.0 GB')
  })
  it('does not show a loading overlay or overlap requests during background polls', async () => {
    let finish!: (value: RuntimeMetrics) => void
    const { controller, gateway } = setup(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ),
    )
    const pending = controller.poll()
    expect(controller.loading.value).toBe(false)
    await controller.poll()
    expect(gateway.metrics).toHaveBeenCalledOnce()
    finish(sample)
    await pending
  })
  it('clears outdated usage when refresh fails and distinguishes a stopped Worker', async () => {
    const { controller, gateway } = setup()
    gateway.metrics.mockResolvedValueOnce({ ...sample, worker_memory_bytes: 0 })
    await controller.refresh()
    expect(controller.workerMemory.value).toBe('未启动')
    gateway.metrics.mockRejectedValueOnce(new Error('disconnected'))
    await controller.poll()
    expect(controller.systemMemory.value).toBe('—')
    expect(controller.memoryPercent.value).toBeNull()
    expect(controller.workerMemory.value).toBe('—')
  })
})
