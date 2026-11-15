import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { TextAssistantView } from '@mlx-studio/api-client'
import { createAssistantController } from './assistant-controller'

function view(jobId: string, state: string): TextAssistantView {
  return { jobId, state, text: state === 'succeeded' ? jobId : '', errorCode: null }
}
function fixture() {
  vi.useFakeTimers()
  const gateway = {
    create: vi.fn(async () => view('old', 'running')),
    get: vi.fn(async () => view('old', 'succeeded')),
    cancel: vi.fn(async () => view('old', 'cancelled')),
  }
  const controller = createAssistantController({
    gateway,
    models: ref([]),
    refreshModels: async () => undefined,
  })
  return { gateway, controller }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  return {
    promise: new Promise<T>((done, fail) => {
      resolve = done
      reject = fail
    }),
    resolve,
    reject,
  }
}
const input = { workspace: 'image' as const, text: 'a lake' }
afterEach(() => vi.useRealTimers())

it.each(['success', 'failure'] as const)(
  'ignores an old cancellation %s after a new generation',
  async (outcome) => {
    const { gateway, controller } = fixture()
    const first = controller.generate(input)
    await vi.advanceTimersByTimeAsync(0)
    const response = deferred<TextAssistantView>()
    gateway.cancel.mockReturnValueOnce(response.promise)
    const cancelling = controller.cancel()
    await vi.advanceTimersByTimeAsync(250)
    await first
    gateway.create.mockResolvedValueOnce(view('new', 'running'))
    gateway.get.mockResolvedValueOnce(view('new', 'succeeded'))
    const second = controller.generate(input)
    await vi.advanceTimersByTimeAsync(0)
    if (outcome === 'success') response.resolve(view('old', 'cancelled'))
    else response.reject(new Error('old cancellation failed'))
    await cancelling
    expect(controller.job.value?.jobId).toBe('new')
    expect(controller.error.value).toBe('')
    await vi.advanceTimersByTimeAsync(250)
    await second
    expect(gateway.get).toHaveBeenLastCalledWith('new')
    expect(controller.draft.value).toBe('new')
    controller.dispose()
  },
)

it.each(['success', 'failure'] as const)(
  'ignores a cancellation %s after disposal',
  async (outcome) => {
    const { gateway, controller } = fixture()
    const generating = controller.generate(input)
    await vi.advanceTimersByTimeAsync(0)
    const response = deferred<TextAssistantView>()
    gateway.cancel.mockReturnValueOnce(response.promise)
    const cancelling = controller.cancel()
    controller.dispose()
    if (outcome === 'success') response.resolve(view('old', 'cancelled'))
    else response.reject(new Error('late cancellation failed'))
    await cancelling
    expect(controller.job.value?.state).toBe('running')
    expect(controller.error.value).toBe('')
    await vi.advanceTimersByTimeAsync(250)
    await generating
    expect(gateway.get).not.toHaveBeenCalled()
  },
)

it('still displays a cancellation failure for the current generation', async () => {
  const { gateway, controller } = fixture()
  const generating = controller.generate(input)
  await vi.advanceTimersByTimeAsync(0)
  gateway.cancel.mockRejectedValueOnce(new Error('cancel unavailable'))
  await controller.cancel()
  expect(controller.error.value).toBe('扩展操作未完成')
  gateway.cancel.mockResolvedValueOnce(view('old', 'cancelled'))
  await controller.cancel()
  expect(controller.job.value?.state).toBe('cancelled')
  controller.dispose()
  await vi.advanceTimersByTimeAsync(250)
  await generating
})
