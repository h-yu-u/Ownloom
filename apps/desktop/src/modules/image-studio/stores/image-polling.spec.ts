import { RuntimeError } from '@mlx-studio/api-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGateway } from '../application/ports'
import type { ImageArtifact, ImageJob } from '../domain/image-state'
import { createImageController } from '../presentation/image-controller'

const artifact: ImageArtifact = {
  id: 'artifact',
  job_id: 'image-job',
  model_id: 'image-model',
  model_name: 'Development',
  prompt: 'a lake',
  width: 512,
  height: 512,
  steps: 20,
  seed: 0,
  simulated: true,
  created_at: 1700000000,
}
const job: ImageJob = {
  ...artifact,
  id: 'image-job',
  state: 'running',
  progress: 10,
  error_code: null,
  artifact_id: null,
}
const completed: ImageJob = {
  ...job,
  state: 'succeeded',
  progress: 100,
  artifact_id: artifact.id,
}
const unavailable = () => new RuntimeError('temporarily unavailable', 'UNAVAILABLE', 503, true)

function fixture() {
  const gateway = {
    listJobs: vi.fn(async () => [job]),
    history: vi.fn(async () => [artifact]),
    artifact: vi.fn(async () => artifact),
    generate: vi.fn(async () => job),
    job: vi.fn(async () => job),
    cancel: vi.fn(async () => undefined),
    image: vi.fn(async () => new Blob(['image'], { type: 'image/png' })),
    upload: vi.fn<ImageGateway['upload']>(),
    metadata: vi.fn<ImageGateway['metadata']>(),
    attachment: vi.fn<ImageGateway['attachment']>(),
  } satisfies ImageGateway
  const state = createImageController({
    directory: { items: [], loading: false, error: null, refresh: vi.fn() },
    refreshModels: vi.fn(async () => undefined),
    exportImage: vi.fn(async () => ({ kind: 'cancelled' as const })),
    gateway,
  })
  state.form.value = {
    modelId: job.model_id,
    prompt: job.prompt,
    width: job.width,
    height: job.height,
    steps: job.steps,
    seed: job.seed,
  }
  return { state, gateway }
}

let current: ReturnType<typeof fixture>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:artifact', revokeObjectURL: vi.fn() })
  current = fixture()
})
afterEach(() => {
  current.state.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Image Studio automatic polling recovery', () => {
  it('retries a transient status failure and discovers the completed artifact', async () => {
    const { state, gateway } = current
    gateway.job.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce(completed)
    await state.generate()
    await vi.advanceTimersByTimeAsync(750)
    expect(state.syncError.value).toContain('temporarily unavailable')
    expect(state.hasActiveJob.value).toBe(true)
    expect(await state.generate()).toBe(false)
    await vi.advanceTimersByTimeAsync(749)
    expect(gateway.job).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(gateway.job).toHaveBeenCalledTimes(2)
    expect(state.syncError.value).toBeNull()
    expect(state.hasActiveJob.value).toBe(false)
    expect(state.selectedArtifact.value?.id).toBe(artifact.id)
    expect(state.urls.value[artifact.id]).toBe('blob:artifact')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('backs off consecutive failures and resets the delay after a successful status read', async () => {
    const { state, gateway } = current
    gateway.job
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce(job)
      .mockRejectedValueOnce(new Error('temporary transport error'))
      .mockResolvedValueOnce(completed)
    await state.generate()
    await vi.advanceTimersByTimeAsync(750)
    expect(gateway.job).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(750)
    expect(gateway.job).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1499)
    expect(gateway.job).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(gateway.job).toHaveBeenCalledTimes(3)
    expect(state.syncError.value).toBeNull()
    await vi.advanceTimersByTimeAsync(750)
    expect(gateway.job).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(749)
    expect(gateway.job).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(gateway.job).toHaveBeenCalledTimes(5)
    expect(state.activeJob.value?.state).toBe('succeeded')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    new RuntimeError('unauthorized', 'UNAUTHORIZED', 401, true),
    new RuntimeError('forbidden', 'FORBIDDEN', 403, true),
    new RuntimeError('not found', 'NOT_FOUND', 404, true),
    new RuntimeError('permanent failure', 'PERMANENT', 500, false),
    new DOMException('cancelled', 'AbortError'),
  ])('does not retry a nonretryable or aborted request: $message', async (cause) => {
    const { state, gateway } = current
    gateway.job.mockRejectedValue(cause)
    await state.generate()
    await vi.advanceTimersByTimeAsync(30000)
    expect(gateway.job).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a scheduled retry when the workspace is disposed', async () => {
    const { state, gateway } = current
    gateway.job.mockRejectedValue(unavailable())
    await state.generate()
    await vi.advanceTimersByTimeAsync(750)
    expect(vi.getTimerCount()).toBe(1)
    state.dispose()
    await vi.advanceTimersByTimeAsync(30000)
    expect(gateway.job).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not restart polling when an in-flight request fails after disposal', async () => {
    const { state, gateway } = current
    let reject!: (cause: Error) => void
    gateway.job.mockReturnValueOnce(
      new Promise<ImageJob>((_resolve, fail) => {
        reject = fail
      }),
    )
    await state.generate()
    await vi.advanceTimersByTimeAsync(750)
    expect(gateway.job).toHaveBeenCalledTimes(1)
    state.dispose()
    reject(unavailable())
    await vi.advanceTimersByTimeAsync(30000)
    expect(gateway.job).toHaveBeenCalledTimes(1)
    expect(state.syncError.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
