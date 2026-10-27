import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { TaskSummary } from '@mlx-studio/api-client'
import { createTaskCenter } from './controller'

afterEach(() => vi.useRealTimers())
const item: TaskSummary = {
  owner: 'runtime',
  id: 'job',
  state: 'running',
  phase: '生成中',
  needsApproval: false,
  target: '/chat',
}

it('reports transport failure in Chinese and retries without duplicate polling', async () => {
  vi.useFakeTimers()
  const tasks = vi.fn().mockRejectedValueOnce(new TypeError('Load failed')).mockResolvedValue([])
  const state = createTaskCenter({ tasks, download: vi.fn() })
  state.start()
  await flushPromises()
  expect(state.error.value).toContain('请重试')
  expect(state.error.value).not.toContain('Load failed')
  expect(state.loaded.value).toBe(false)
  await state.refresh()
  expect(state.loaded.value).toBe(true)
  expect(state.error.value).toBe('')
  await vi.advanceTimersByTimeAsync(5000)
  expect(tasks).toHaveBeenCalledTimes(3)
  state.stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps the previous tasks on failure and shares an in-flight refresh', async () => {
  const tasks = vi.fn().mockResolvedValueOnce([item]).mockRejectedValue(new Error('offline'))
  const state = createTaskCenter({ tasks, download: vi.fn() })
  state.start()
  await flushPromises()
  const refresh = state.refresh()
  expect(state.refresh()).toBe(refresh)
  await refresh
  expect(tasks).toHaveBeenCalledTimes(2)
  expect(state.items.value).toEqual([item])
  expect(state.loaded.value).toBe(true)
  expect(state.error.value).toBeTruthy()
  state.stop()
})

it('ignores a late result from a stopped observer after a new start', async () => {
  let resolveOld: (items: TaskSummary[]) => void = () => {}
  const tasks = vi
    .fn()
    .mockImplementationOnce(() => new Promise<TaskSummary[]>((resolve) => (resolveOld = resolve)))
    .mockResolvedValue([])
  const state = createTaskCenter({ tasks, download: vi.fn() })
  state.start()
  state.stop()
  state.start()
  await flushPromises()
  resolveOld([item])
  await flushPromises()
  expect(state.items.value).toEqual([])
  expect(state.loading.value).toBe(false)
  state.stop()
})

it('keeps successful task data when the model directory fails and retries that refresh', async () => {
  const completed = { ...item, owner: 'download', state: 'available' }
  const refreshModels = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
  const state = createTaskCenter({
    tasks: vi.fn().mockResolvedValue([completed]),
    download: vi.fn(),
    refreshModels,
  })
  state.start()
  await flushPromises()
  expect(state.items.value).toEqual([completed])
  expect(state.error.value).toContain('模型列表刷新失败')
  await state.refresh()
  expect(refreshModels).toHaveBeenCalledTimes(2)
  expect(state.error.value).toBe('')
  state.stop()
})

it('counts one active task for multiple execution records in the same session', async () => {
  const state = createTaskCenter({
    tasks: vi.fn().mockResolvedValue([
      { ...item, groupId: 'coding:session', owner: 'coding' },
      { ...item, id: 'child', groupId: 'coding:session', parentId: item.id },
    ]),
    download: vi.fn(),
  })
  state.start()
  await flushPromises()
  expect(state.items.value).toHaveLength(2)
  expect(state.groups.value).toHaveLength(1)
  expect(state.active.value).toHaveLength(1)
  state.stop()
})
