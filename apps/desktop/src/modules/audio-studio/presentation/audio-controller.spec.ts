import { createPinia, setActivePinia } from 'pinia'
import { RuntimeError } from '@mlx-studio/api-client'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modelFixture } from '../../../test-fixtures/runtime'
import { useModelDirectory, useModelDirectoryState } from '../../../capabilities/models/directory'
import { createAudioController } from './audio-controller'
import { buildSpeechRequest } from '../application/speech-request'
import type { AudioArtifact, AudioGateway, AudioJob, Voice } from '../application/ports'

const operation = {
  mode: 'preset' as const,
  languages: ['zh', 'auto'],
  presetSpeakers: ['demo'],
  referenceAudio: 'unsupported' as const,
  referenceText: 'unsupported' as const,
  stylePrompt: false,
  streamKind: 'none' as const,
  maxTextCharacters: 2000,
  maxReferenceSeconds: 30,
}
const model = modelFixture({
  id: 'speech',
  task: 'text-to-speech',
  outputModalities: ['audio'],
  speech: {
    family: 'fake',
    variant: 'custom_voice',
    operations: [
      operation,
      {
        ...operation,
        mode: 'clone',
        presetSpeakers: [],
        referenceAudio: 'required',
        referenceText: 'required',
      },
    ],
    verification: 'validated',
    adapterVersion: 'fake-v1',
    unavailableReason: null,
  },
})
const job: AudioJob = {
  id: 'job',
  model_id: 'speech',
  model_name: 'Test',
  model_revision: null,
  model_identity: null,
  adapter_version: 'fake-v1',
  mode: 'preset',
  text: 'hello',
  language: 'zh',
  speaker: 'demo',
  voice_id: null,
  voice_snapshot: null,
  simulated: true,
  state: 'queued',
  error_code: null,
  artifact_id: null,
  created_at: 1,
}
const artifact: AudioArtifact = {
  ...job,
  id: 'artifact',
  job_id: 'job',
  asset_id: 'asset',
  duration_seconds: 1,
  sample_rate: 24000,
  channels: 1,
  peaks: [0.2],
  elapsed_seconds: 0.5,
  rtf: 0.5,
}
const voice: Voice = {
  id: 'voice',
  name: '参考音色',
  reference_asset_id: 'reference',
  reference_text: 'hello',
  language: 'zh',
  source: 'self',
  consent: true,
  consent_at: 1,
  created_at: 1,
  version: 1,
}
const api = {
  references: vi.fn(),
  voices: vi.fn(),
  createVoice: vi.fn(),
  updateVoice: vi.fn(),
  deleteVoice: vi.fn(),
  deleteAsset: vi.fn(),
  upload: vi.fn(),
  generate: vi.fn(),
  jobs: vi.fn(),
  job: vi.fn(),
  cancel: vi.fn(),
  history: vi.fn(),
  artifact: vi.fn(),
  deleteArtifact: vi.fn(),
  audio: vi.fn(),
  reference: vi.fn(),
} satisfies AudioGateway
const NativeURL = URL
let store: ReturnType<typeof createStore>
function createStore() {
  return reactive(
    createAudioController({
      directory: useModelDirectory(),
      refreshModels: async () => undefined,
      gateway: api,
      exportAudio: vi.fn(),
    }),
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  setActivePinia(createPinia())
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:audio')
      static revokeObjectURL = vi.fn()
    },
  )
  useModelDirectoryState().items = [model]
  api.voices.mockResolvedValue([voice])
  api.references.mockResolvedValue([])
  api.jobs.mockResolvedValue([])
  api.history.mockResolvedValue([])
  api.artifact.mockImplementation(async (id: string) => ({ ...artifact, id }))
  api.audio.mockResolvedValue(new Blob(['wav']))
  api.reference.mockResolvedValue(new Blob(['wav']))
  store = createStore()
})
afterEach(() => {
  store.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('Audio Studio', () => {
  it('selects the newly completed work when a running task finished while away', async () => {
    api.jobs.mockResolvedValue([job])
    api.history.mockResolvedValue([artifact])
    await store.loadWorkspace()
    store.dispose()
    const next = { ...artifact, id: 'new-artifact' }
    api.jobs.mockResolvedValue([{ ...job, state: 'succeeded', artifact_id: next.id }])
    api.history.mockResolvedValue([next, artifact])
    await store.loadWorkspace()
    expect(store.selectedId).toBe(next.id)
  })
  it('constructs strict mode-specific requests without stale inputs', () => {
    const draft = {
      modelId: model.id,
      mode: 'preset' as const,
      text: 'hello',
      language: 'zh',
      speaker: 'demo',
      voiceId: 'stale',
    }
    expect(buildSpeechRequest(draft, [model])).not.toHaveProperty('voiceId')
    const clone = buildSpeechRequest({ ...draft, mode: 'clone' }, [model])
    expect(clone).toMatchObject({ voiceId: 'stale', mode: 'clone' })
    expect(clone).not.toHaveProperty('speaker')
    expect(() => buildSpeechRequest({ ...draft, text: '' }, [model])).toThrow()
    expect(() => buildSpeechRequest({ ...draft, language: 'xx' }, [model])).toThrow()
  })
  it('preserves the idempotency key after a transport failure and avoids duplicate submission', async () => {
    await store.loadWorkspace()
    store.form.text = 'hello'
    api.generate.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(job)
    await store.generate()
    await store.generate()
    expect(api.generate.mock.calls[0]?.[0].clientRequestId).toBe(
      api.generate.mock.calls[1]?.[0].clientRequestId,
    )
    await store.generate()
    expect(api.generate).toHaveBeenCalledTimes(2)
    expect(store.busy).toBe(true)
  })
  it('restores running tasks after leaving, polls completion and revokes playback URLs', async () => {
    api.jobs.mockResolvedValue([job])
    await store.loadWorkspace()
    expect(store.busy).toBe(true)
    store.dispose()
    expect(api.cancel).not.toHaveBeenCalled()
    await store.loadWorkspace()
    api.job.mockResolvedValue({ ...job, state: 'succeeded', artifact_id: artifact.id })
    api.jobs.mockResolvedValue([{ ...job, state: 'succeeded', artifact_id: artifact.id }])
    api.history.mockResolvedValue([artifact])
    await vi.advanceTimersByTimeAsync(750)
    expect(store.selectedArtifact?.id).toBe(artifact.id)
    expect(store.urls[artifact.id]).toBe('blob:audio')
    expect(store.busy).toBe(false)
    store.dispose()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio')
    expect(store.urls).toEqual({})
  })
  it('ignores a stale history response after a new workspace opens', async () => {
    let resolve!: (value: AudioArtifact[]) => void
    api.history.mockReturnValueOnce(
      new Promise<AudioArtifact[]>((done) => {
        resolve = done
      }),
    )
    const loading = store.loadWorkspace()
    await vi.advanceTimersByTimeAsync(0)
    store.dispose()
    await store.loadWorkspace()
    resolve([artifact])
    await loading
    expect(store.artifacts).toEqual([])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
  it('blocks voice saving without consent and cleans abandoned references', async () => {
    api.upload.mockResolvedValue({ id: 'reference', original_name: 'ref.wav' })
    api.createVoice.mockResolvedValue(voice)
    await store.library.upload(new File(['wav'], 'ref.wav'))
    store.library.form.reference_text = 'hello'
    await store.library.save()
    expect(api.createVoice).not.toHaveBeenCalled()
    expect(store.library.error).toContain('授权')
    store.library.consent = true
    await store.library.save()
    expect(store.voices).toContainEqual(voice)
    await store.library.upload(new File(['wav'], 'ref.wav'))
    store.dispose()
    expect(api.deleteAsset).toHaveBeenCalledWith('reference')
  })
  it('surfaces state sync failures and allows a manual retry', async () => {
    api.jobs.mockResolvedValue([job])
    await store.loadWorkspace()
    api.job.mockRejectedValueOnce(new Error('offline'))
    await store.refreshJob()
    expect(store.syncError).toBe('offline')
    api.job.mockResolvedValue({ ...job, state: 'cancelled' })
    api.jobs.mockResolvedValue([{ ...job, state: 'cancelled' }])
    await store.refreshJob()
    expect(store.syncError).toBeNull()
    expect(store.busy).toBe(false)
  })
})

describe('Audio polling recovery', () => {
  it('automatically recovers a failed query and stops at completion', async () => {
    api.jobs.mockResolvedValue([job])
    await store.loadWorkspace()
    const completed = { ...job, state: 'succeeded' as const, artifact_id: artifact.id }
    api.job
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...job, state: 'running' })
      .mockResolvedValueOnce(completed)
    await vi.advanceTimersByTimeAsync(750)
    expect(store.syncError).toBe('offline')
    await vi.advanceTimersByTimeAsync(750)
    expect(store.syncError).toBeNull()
    api.jobs.mockResolvedValue([completed])
    api.history.mockResolvedValue([artifact])
    await vi.advanceTimersByTimeAsync(750)
    expect(store.busy).toBe(false)
    expect(store.selectedId).toBe(artifact.id)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('backs off repeated failures and cancels retry on disposal', async () => {
    api.jobs.mockResolvedValue([job])
    api.job.mockRejectedValue(new Error('offline'))
    await store.loadWorkspace()
    await vi.advanceTimersByTimeAsync(1500)
    expect(api.job).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1499)
    expect(api.job).toHaveBeenCalledTimes(2)
    store.dispose()
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.job).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores a failed in-flight request after leaving', async () => {
    api.jobs.mockResolvedValue([job])
    await store.loadWorkspace()
    let reject!: (error: Error) => void
    api.job.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail
      }),
    )
    const refresh = store.refreshJob()
    store.dispose()
    reject(new Error('late failure'))
    await refresh
    expect(store.syncError).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Audio non-retryable failures', () => {
  it.each([401, 403, 404])('does not retry HTTP %s even if marked retryable', async (status) => {
    api.jobs.mockResolvedValue([job])
    api.job.mockRejectedValue(new RuntimeError('unavailable', 'REQUEST_FAILED', status, true))
    await store.loadWorkspace()
    await vi.advanceTimersByTimeAsync(750)
    expect(api.job).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not retry an aborted observation', async () => {
    api.jobs.mockResolvedValue([job])
    api.job.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await store.loadWorkspace()
    await vi.advanceTimersByTimeAsync(750)
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('preserves the newer submission identity when an old workspace response arrives late', async () => {
  await store.loadWorkspace()
  store.form.text = 'first'
  let finish!: (job: AudioJob) => void
  api.generate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const old = store.generate()
  store.dispose()
  await store.loadWorkspace()
  store.form.text = 'second'
  api.generate.mockRejectedValueOnce(new Error('lost response'))
  await store.generate()
  const request = api.generate.mock.calls[1]?.[0].clientRequestId
  finish(job)
  await old
  api.generate.mockResolvedValueOnce({ ...job, id: 'second' })
  await store.generate()
  expect(api.generate.mock.calls[2]?.[0].clientRequestId).toBe(request)
  expect(store.activeJob?.id).toBe('second')
})

it('deletes A without disturbing B, even when the post-delete refresh fails', async () => {
  api.history.mockResolvedValueOnce([artifact])
  await store.loadWorkspace()
  let complete!: (value: unknown) => void
  api.deleteArtifact.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const deleting = store.remove(artifact.id)
  await store.select('B')
  api.history.mockRejectedValueOnce(new Error('refresh failed'))
  complete({})
  expect(await deleting).toBe(true)
  expect(store.selectedArtifact?.id).toBe('B')
  expect(store.artifacts.some((item) => item.id === artifact.id)).toBe(false)
  expect(store.historyError).toBe('refresh failed')
})
