import { useModelDirectoryState } from '../../../capabilities/models/directory'
import { installWorkspaces } from '../../../app/composition-root'
import { modelFixture } from '../../../test-fixtures/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useImageStudioStore } from './image-studio.store'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  downloadImageArtifact: vi.fn(),
  uploadImage: vi.fn(),
  downloadAttachment: vi.fn(),
}))
vi.mock('../../../platform/runtime-bridge', () => ({ runtimeClient: async () => api }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
const artifact = {
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
const job = {
  ...artifact,
  id: 'image-job',
  state: 'queued',
  progress: 0,
  error_code: null,
  artifact_id: null,
}
const imageModel = modelFixture({
  id: 'image-model',
  displayName: 'Development',
  source: 'builtin',
  engine: 'fake',
  task: 'image-generation',
  state: 'available',
  localPath: 'fake://image',
  outputModalities: ['image'],
})
const NativeURL = URL
let store: ReturnType<typeof useImageStudioStore>

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:artifact')
      static revokeObjectURL = vi.fn()
    },
  )
  setActivePinia(createPinia())
  useModelDirectoryState().items = [imageModel]
  store = useImageStudioStore()
  store.form = {
    modelId: 'image-model',
    prompt: 'a lake',
    width: 512,
    height: 512,
    steps: 20,
    seed: 0,
  }
  api.get.mockImplementation(async (path: string) =>
    path.startsWith('/internal/v1/image-artifacts/') ? artifact : undefined,
  )
  api.downloadImageArtifact.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
})
afterEach(() => {
  store.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Image Studio workspace', () => {
  it('uses a saved work as the next source and preserves its dimensions', async () => {
    useModelDirectoryState().items = [
      {
        ...imageModel,
        source: 'local',
        capabilities: { imageEditing: true, inpainting: true, multiImage: true },
      },
    ]
    api.get.mockResolvedValueOnce({ ...artifact, width: 768, height: 576 })
    await store.selectArtifact(artifact.id)
    api.uploadImage.mockResolvedValue({ id: 'continued', originalName: '原作品.png' })
    api.downloadAttachment.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    await store.editArtifact()
    expect(store.form).toMatchObject({
      mode: 'edit',
      referenceIds: ['continued'],
      width: 768,
      height: 576,
      steps: 40,
      prompt: '',
    })
    expect(store.preparingEdit).toBe(false)
  })
  it('uploads and orders references, clears a stale mask when the source changes, and submits an edit', async () => {
    api.uploadImage
      .mockResolvedValueOnce({ id: 'one', originalName: 'one.png' })
      .mockResolvedValueOnce({ id: 'two', originalName: 'two.png' })
    api.downloadAttachment.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    store.form = { ...store.form, mode: 'edit', referenceIds: [], strength: 0.8 }
    await store.uploadReferences([
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.png', { type: 'image/png' }),
    ])
    expect(store.form.referenceIds).toEqual(['one', 'two'])
    store.form.maskId = 'old-mask'
    store.moveReference(1, -1)
    expect(store.form.referenceIds).toEqual(['two', 'one'])
    expect(store.form.maskId).toBeNull()
    api.post.mockResolvedValue({
      ...job,
      mode: 'edit',
      reference_ids: ['two', 'one'],
      strength: 0.8,
    })
    await store.generate()
    expect(api.post).toHaveBeenCalledWith(
      '/internal/v1/image-jobs',
      expect.objectContaining({ mode: 'edit', reference_ids: ['two', 'one'], strength: 0.8 }),
    )
  })

  it('preserves already uploaded references if a later upload fails', async () => {
    api.uploadImage
      .mockResolvedValueOnce({ id: 'one', originalName: 'one.png' })
      .mockRejectedValueOnce(new Error('upload failed'))
    api.downloadAttachment.mockResolvedValue(new Blob(['image']))
    await store.uploadReferences([
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.png', { type: 'image/png' }),
    ])
    expect(store.form.referenceIds).toEqual(['one'])
    expect(store.uploading).toBe(false)
    expect(store.inputError).toContain('upload failed')
  })
  it('prefers a real local image model on first entry', async () => {
    const local = { ...imageModel, id: 'qwen-image-local', source: 'local', engine: 'local-image' }
    store.form.modelId = null
    api.get.mockImplementation(async (path: string) =>
      path === '/internal/v1/models' ? [imageModel, local] : [],
    )
    await store.loadWorkspace()
    expect(store.form.modelId).toBe(local.id)
    store.form.prompt = 'a teapot'
    api.post.mockResolvedValue({ ...job, model_id: local.id, simulated: false })
    await store.generate()
    expect(api.post).toHaveBeenCalledWith(
      '/internal/v1/image-jobs',
      expect.objectContaining({ model_id: local.id }),
    )
    expect(store.activeJob?.simulated).toBe(false)
  })

  it('submits a selected model once and loads the persisted artifact when generation completes', async () => {
    api.post.mockResolvedValue(job)
    expect(await store.generate()).toBe(true)
    expect(await store.generate()).toBe(false)
    expect(api.post).toHaveBeenCalledWith('/internal/v1/image-jobs', {
      model_id: 'image-model',
      prompt: 'a lake',
      width: 512,
      height: 512,
      steps: 20,
      seed: 0,
      client_request_id: expect.any(String),
      mode: 'generate',
      strength: 1,
    })
    api.get.mockImplementation(async (path: string) =>
      path.startsWith('/internal/v1/image-artifacts/')
        ? artifact
        : path.includes('/image-jobs/')
          ? { ...job, state: 'succeeded', progress: 100, artifact_id: artifact.id }
          : [artifact],
    )
    await store.refreshJob()
    expect(store.hasActiveJob).toBe(false)
    expect(store.selectedArtifact?.id).toBe(artifact.id)
    expect(store.urls[artifact.id]).toBe('blob:artifact')
    expect(api.downloadImageArtifact).toHaveBeenCalledWith(artifact.id, expect.any(AbortSignal))
  })

  it('refreshes after an older gallery request so completion cannot lose the new artifact', async () => {
    let finishOlder: (value: unknown) => void = () => undefined
    api.get.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOlder = resolve
      }),
    )
    api.get.mockResolvedValueOnce({
      ...job,
      state: 'succeeded',
      progress: 100,
      artifact_id: artifact.id,
    })
    api.get.mockResolvedValueOnce([artifact])
    const older = store.loadHistory(true)
    await Promise.resolve()
    await Promise.resolve()
    store.activeJob = { ...job, state: 'running' }
    const completion = store.refreshJob()
    await Promise.resolve()
    await Promise.resolve()
    finishOlder([])
    await Promise.all([older, completion])
    expect(store.selectedArtifact?.id).toBe(artifact.id)
    expect(store.artifacts).toHaveLength(1)
  })

  it('retains drafts on submission failure and exposes terminal generation failures', async () => {
    api.post.mockRejectedValueOnce(new Error('offline'))
    expect(await store.generate()).toBe(false)
    expect(store.form.prompt).toBe('a lake')
    expect(store.submitting).toBe(false)
    api.post.mockResolvedValue(job)
    await store.generate()
    api.get.mockResolvedValue({ ...job, state: 'failed', error_code: 'MODEL_LOAD_FAILED' })
    await store.refreshJob()
    expect(store.hasActiveJob).toBe(false)
    expect(store.error).toContain('模型加载失败')
  })

  it('blocks duplicate generation after a synchronization interruption and permits reconnecting', async () => {
    api.post.mockResolvedValue(job)
    await store.generate()
    api.get.mockRejectedValueOnce(new Error('lost connection'))
    await store.refreshJob()
    expect(store.syncError).toContain('lost connection')
    expect(store.hasActiveJob).toBe(true)
    expect(await store.generate()).toBe(false)
    api.get.mockResolvedValue({ ...job, state: 'cancelled' })
    await store.refreshJob()
    expect(store.syncError).toBeNull()
    expect(store.hasActiveJob).toBe(false)
  })

  it('restores saved gallery items and resumes an ongoing job on workspace entry', async () => {
    api.get.mockImplementation(async (path: string) =>
      path === '/internal/v1/models'
        ? [imageModel]
        : path === '/internal/v1/image-jobs'
          ? [{ ...job, state: 'running', progress: 35 }]
          : path.startsWith('/internal/v1/image-artifacts/')
            ? artifact
            : [artifact],
    )
    await store.loadWorkspace()
    expect(store.activeJob?.progress).toBe(35)
    expect(store.hasActiveJob).toBe(true)
    expect(store.selectedArtifact?.seed).toBe(0)
    expect(store.artifacts).toHaveLength(1)
    expect(store.historyLoading).toBe(false)
  })

  it('reuses stored parameters and requires a new model choice if the original model was removed', async () => {
    await store.reuse(artifact)
    expect(store.form.seed).toBe(0)
    expect(store.form.modelId).toBe('image-model')
    useModelDirectoryState().items = []
    await store.reuse(artifact)
    expect(store.form.modelId).toBeNull()
    expect(store.restoreAdjustments[0]?.code).toBe('model-missing')
  })

  it('settles cancellation and keeps successful artifacts unchanged', async () => {
    store.artifacts = [artifact]
    store.activeJob = { ...job, state: 'running' }
    api.post.mockResolvedValue({ state: 'cancelled' })
    api.get.mockResolvedValue({ ...job, state: 'cancelled' })
    await store.cancel()
    expect(api.post).toHaveBeenCalledWith('/internal/v1/image-jobs/image-job/cancel')
    expect(store.activeJob?.state).toBe('cancelled')
    expect(store.cancelling).toBe(false)
    expect(store.artifacts).toEqual([artifact])
  })
})

installWorkspaces()

it('reuses the same submission identity when a response is lost', async () => {
  api.post.mockRejectedValueOnce(new Error('response lost'))
  expect(await store.generate()).toBe(false)
  api.post.mockResolvedValueOnce(job)
  expect(await store.generate()).toBe(true)
  expect(api.post.mock.calls[1]?.[1].client_request_id).toBe(
    api.post.mock.calls[0]?.[1].client_request_id,
  )
})

it('does not export a late download after the workspace is disposed', async () => {
  let finish: (value: Blob) => void = () => undefined
  api.downloadImageArtifact.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const task = store.saveArtifact('artifact')
  await Promise.resolve()
  store.dispose()
  finish(new Blob(['image']))
  await task
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
