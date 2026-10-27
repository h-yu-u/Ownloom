import { createDraftRestorer } from '../../../shared/lib/draft-restorer'
import { restoreSpeech } from '../application/restore-speech'
import type { FileExportResult } from '../../../shared/lib/file-export'
import { createAudioHistoryController } from './audio-history-controller'
import { SubmitSpeech } from '../application/submit-speech'
import { computed, ref, watch } from 'vue'
import type {
  AudioArtifact,
  AudioGateway,
  AudioJob,
  SpeechDraft,
  Voice,
} from '../application/ports'
import { compatibleModels, terminal, deriveSpeechReadiness } from '../application/speech-request'
import type { useModelDirectory } from '../../../capabilities/models'
import { JobPoller } from '../../../capabilities/jobs'
import { createVoiceController } from './voice-controller'
import { audioFailure } from './audio-feedback'

interface Dependencies {
  directory: ReturnType<typeof useModelDirectory>
  refreshModels(): Promise<void>
  gateway: AudioGateway
  exportAudio(blob: Blob, id: string): Promise<FileExportResult>
}
export function createAudioController(deps: Dependencies) {
  const form = ref<SpeechDraft>({
    modelId: null,
    mode: 'preset',
    text: '',
    language: 'zh',
    speaker: null,
    voiceId: null,
  })
  const voices = ref<Voice[]>([])
  const library = createVoiceController(deps.gateway, voices)
  const jobs = ref<AudioJob[]>([])
  const activeJob = ref<AudioJob | null>(null)
  const error = ref<string | null>(null)
  const syncError = ref<string | null>(null)
  const loading = ref(false),
    submitting = ref(false),
    cancelling = ref(false)
  const speechModels = computed(() => compatibleModels(deps.directory.items, form.value.mode))
  const selectedModel = computed(() =>
    speechModels.value.find((model) => model.id === form.value.modelId),
  )
  const busy = computed(() => !!activeJob.value && !terminal(activeJob.value))
  const history = createAudioHistoryController({
    ...deps,
    onError: (cause) => {
      error.value = cause instanceof Error ? cause.message : '作品请求失败'
    },
  })
  const {
    artifacts,
    selectedId,
    selectedArtifact,
    urls,
    historyLoading,
    hasMore,
    savingId,
    loadHistory,
    select,
    save,
    remove,
  } = history
  const poller = new JobPoller()
  let epoch = 0,
    disposed = false
  let scope = new AbortController()
  const submit = new SubmitSpeech(deps.gateway, () => crypto.randomUUID())
  let polling = false
  let submittedSelection = 0

  const restorer = createDraftRestorer(form)
  const voiceConfirmed = ref(false)
  watch(
    () => [form.value.voiceId, form.value.mode],
    () => {
      voiceConfirmed.value = false
    },
    { flush: 'sync' },
  )
  const voiceChange = computed(() =>
    restorer.adjustments.value.find(
      (notice) => notice.code === 'voice-changed' && notice.resourceId === form.value.voiceId,
    ),
  )
  const readiness = computed(() =>
    deriveSpeechReadiness(form.value, deps.directory.items, voices.value),
  )
  async function action(run: (owner: number) => Promise<void>): Promise<boolean> {
    const owner = epoch
    error.value = null
    try {
      await run(owner)
      return owner === epoch && !disposed
    } catch (cause) {
      if (owner === epoch && !disposed)
        error.value = cause instanceof Error ? cause.message : '语音工作区请求失败'
      return false
    }
  }
  async function loadWorkspace(): Promise<void> {
    dispose()
    disposed = false
    history.activate()
    restorer.activate()
    scope = new AbortController()
    const owner = epoch
    loading.value = true
    await action(async () => {
      const [, nextVoices, nextJobs, nextReferences] = await Promise.all([
        deps.refreshModels(),
        deps.gateway.voices(scope.signal),
        deps.gateway.jobs(scope.signal),
        deps.gateway.references(scope.signal),
      ])
      if (owner !== epoch) return
      voices.value = nextVoices
      library.references = nextReferences
      jobs.value = nextJobs
      if (!form.value.modelId && !form.value.text) {
        const model =
          speechModels.value.find((item) => item.source !== 'builtin') ?? speechModels.value[0]
        const op = model?.speech?.operations.find((item) => item.mode === form.value.mode)
        form.value = {
          ...form.value,
          modelId: model?.id ?? null,
          speaker: op?.presetSpeakers[0] ?? null,
          language: op?.languages.includes(form.value.language)
            ? form.value.language
            : (op?.languages[0] ?? 'auto'),
        }
      }
      const resuming = activeJob.value ? !terminal(activeJob.value) : true
      activeJob.value = nextJobs.find((job) => !terminal(job)) ?? nextJobs[0] ?? null
      if (
        resuming &&
        activeJob.value?.artifact_id &&
        submittedSelection === history.getSelectionRevision()
      )
        await history.select(activeJob.value.artifact_id, false)
      await loadHistory(true)
      if (owner === epoch && busy.value) poller.schedule(refreshJob)
    })
    if (owner === epoch) loading.value = false
  }
  async function generate(): Promise<void> {
    if (
      busy.value ||
      submitting.value ||
      disposed ||
      !readiness.value.canSubmit ||
      (voiceChange.value && !voiceConfirmed.value)
    )
      return
    submittedSelection = history.getSelectionRevision()
    submitting.value = true
    const owner = epoch
    await action(async () => {
      const job = await submit.execute(form.value, deps.directory.items)
      if (owner !== epoch) return
      activeJob.value = job
      jobs.value = [job, ...jobs.value.filter((item) => item.id !== job.id)]
      poller.schedule(refreshJob)
    })
    if (owner === epoch) submitting.value = false
  }
  async function refreshJob(): Promise<void> {
    if (polling || disposed || !activeJob.value) return
    polling = true
    poller.stop()
    const owner = epoch,
      id = activeJob.value.id
    try {
      const job = await deps.gateway.job(id, scope.signal)
      if (owner !== epoch) return
      activeJob.value = job
      jobs.value = jobs.value.map((item) => (item.id === id ? job : item))
      syncError.value = null
      poller.recovered()
      if (job.state === 'succeeded') {
        if (job.artifact_id && submittedSelection === history.getSelectionRevision())
          await history.select(job.artifact_id, false)
        await loadHistory(true)
      }
      if (job.state === 'failed') error.value = audioFailure(job.error_code)
      if (terminal(job)) {
        const nextJobs = await deps.gateway.jobs(scope.signal)
        if (owner !== epoch) return
        jobs.value = nextJobs
        activeJob.value = nextJobs.find((item) => !terminal(item)) ?? job
      }
      if (busy.value) poller.schedule(refreshJob)
    } catch (cause) {
      if (owner === epoch && !disposed) {
        syncError.value = cause instanceof Error ? cause.message : '任务同步中断'
        if (busy.value) poller.retry(refreshJob, cause)
      }
    } finally {
      if (owner === epoch) polling = false
    }
  }
  async function cancel(): Promise<void> {
    if (
      !activeJob.value ||
      !busy.value ||
      activeJob.value.state === 'cancelling' ||
      cancelling.value
    )
      return
    const id = activeJob.value.id,
      owner = epoch
    cancelling.value = true
    const cancelled = await action(async () => {
      await deps.gateway.cancel(id)
      if (owner === epoch) await refreshJob()
    })
    if (!cancelled && owner === epoch) await refreshJob()
    if (owner === epoch) cancelling.value = false
  }
  async function reuse(item: AudioArtifact | AudioJob): Promise<void> {
    if (busy.value || submitting.value) return
    try {
      await restorer.restore(async () => {
        const currentVoices = await deps.gateway.voices()
        return restoreSpeech(item, deps.directory.items, currentVoices)
      })
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '恢复参数失败，请重试'
    }
  }
  function dispose(): void {
    restorer.dispose()
    epoch++
    disposed = true
    scope.abort()
    poller.stop()
    poller.recovered()
    history.dispose()
    library.dispose()
    loading.value = false
    submitting.value = false
    cancelling.value = false
    polling = false
  }
  return {
    form,
    readiness,
    restorePending: restorer.pending,
    restoreCandidate: restorer.candidate,
    restoreAdjustments: restorer.adjustments,
    applyRestoreCandidate: restorer.applyCandidate,
    voiceChange,
    voiceConfirmed,
    voices,
    library,
    artifacts,
    jobs,
    activeJob,
    selectedId,
    urls,
    error,
    syncError,
    loading,
    submitting,
    cancelling,
    historyLoading,
    historyError: history.historyError,
    historyPhase: history.phase,
    detailError: history.detailError,
    detailLoading: history.detailLoading,
    mediaErrors: history.mediaErrors,
    savingById: history.savingById,
    hasMore,
    savingId,
    speechModels,
    selectedModel,
    selectedArtifact,
    busy,
    loadWorkspace,
    loadHistory,
    select,
    generate,
    refreshJob,
    cancel,
    reuse,
    save,
    remove,
    dispose,
  }
}
