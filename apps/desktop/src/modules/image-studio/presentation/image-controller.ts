import { createDraftRestorer } from '../../../shared/lib/draft-restorer'
import { restoreImage } from '../domain/restore-image'
import type { FileExportResult } from '../../../shared/lib/file-export'
import { SubmitImage } from '../application/submit-image'
import { imageJobError, validationMessages } from './image-feedback'
import { computed, ref } from 'vue'
import {
  ImageValidationError,
  isTerminal,
  type ImageArtifact,
  type ImageDraft,
  type ImageJob,
} from '../domain/image-state'
import type { ImageGateway } from '../application/ports'
import type { useModelDirectory } from '../../../capabilities/models'
import { createArtifactHistory } from '../../../capabilities/media'
import { JobPoller } from '../../../capabilities/jobs'
import { createImageInputs } from './image-inputs'
import { createImageDraft } from '../domain/image-draft'
interface ImageDependencies {
  directory: ReturnType<typeof useModelDirectory>
  refreshModels(): Promise<void>
  gateway: ImageGateway
  exportImage(blob: Blob, id: string, signal?: AbortSignal): Promise<FileExportResult>
}

export function createImageController(deps: ImageDependencies) {
  const models = deps.directory
  const submission = new SubmitImage(deps.gateway)
  const form = ref<ImageDraft>(createImageDraft())
  const inputs = createImageInputs(form, deps.gateway)
  const restorer = createDraftRestorer(form)
  const history = createArtifactHistory({
    ...deps.gateway,
    content: deps.gateway.image,
    thumbnail: deps.gateway.thumbnail,
    export: deps.exportImage,
  })
  const {
    artifacts,
    selectedId,
    selectedArtifact,
    urls,
    historyLoading,
    historyError,
    hasMore,
    savingId,
    loadHistory,
    save: saveArtifact,
    loadMedia: loadImage,
  } = history
  const imageErrors = history.mediaErrors
  const jobs = ref<ImageJob[]>([]),
    activeJob = ref<ImageJob | null>(null)
  const loading = ref(false),
    submitting = ref(false),
    preparingEdit = ref(false),
    cancelling = ref(false)
  const error = ref<string | null>(null),
    syncError = ref<string | null>(null)
  let submittedSelection = 0
  const imageModels = computed(() =>
    models.items.filter((model) => model.task === 'image-generation'),
  )
  const modelError = computed(() => models.error)
  const hasActiveJob = computed(() => !!activeJob.value && !isTerminal(activeJob.value))
  const poller = new JobPoller()
  let epoch = 0
  let scope = new AbortController()
  let disposed = false
  let polling = false
  async function loadWorkspace(): Promise<void> {
    scope.abort()
    scope = new AbortController()
    const owner = ++epoch
    disposed = false
    history.activate()
    restorer.activate()
    loading.value = true
    error.value = null
    try {
      await deps.refreshModels()
      if (!form.value.modelId) {
        form.value.modelId =
          imageModels.value.find(
            (item) => item.source !== 'builtin' && item.capabilities.imageEditing,
          )?.id ??
          imageModels.value.find((item) => item.source !== 'builtin')?.id ??
          imageModels.value[0]?.id ??
          null
      }
      const nextJobs = await deps.gateway.listJobs(scope.signal)
      if (owner !== epoch || disposed) return
      jobs.value = nextJobs
      activeJob.value =
        jobs.value.find((item) => !isTerminal(item)) ?? activeJob.value ?? jobs.value[0] ?? null
      await loadHistory(true)
      if (hasActiveJob.value) schedulePoll()
      await inputs.restoreInputs()
    } catch (cause) {
      error.value = errorText(cause)
    } finally {
      if (owner === epoch) loading.value = false
    }
  }

  async function generate(): Promise<boolean> {
    const owner = epoch
    if (
      submitting.value ||
      hasActiveJob.value ||
      inputs.uploading.value ||
      preparingEdit.value ||
      form.value.referenceIds?.some((id) => inputs.inputErrors.value[id])
    )
      return false
    error.value = null
    submittedSelection = history.getSelectionRevision()
    submitting.value = true
    try {
      const next = await submission.run(form.value)
      if (!next) return false
      if (owner !== epoch || disposed) return false
      activeJob.value = next
      syncError.value = null
      jobs.value = [
        activeJob.value,
        ...jobs.value.filter((item) => item.id !== activeJob.value?.id),
      ]
      schedulePoll()
      return true
    } catch (cause) {
      error.value = errorText(cause)
      return false
    } finally {
      if (owner === epoch) submitting.value = false
    }
  }

  async function refreshJob(): Promise<void> {
    if (!activeJob.value || polling) return
    poller.stop()
    const owner = epoch
    polling = true
    const id = activeJob.value.id
    syncError.value = null
    try {
      const next = await deps.gateway.job(id, scope.signal)
      if (owner !== epoch || disposed || activeJob.value?.id !== id) return
      activeJob.value = next
      jobs.value = [next, ...jobs.value.filter((item) => item.id !== id)]
      if (next.state === 'succeeded') {
        await loadHistory(true)
        if (next.artifact_id && submittedSelection === history.getSelectionRevision())
          await history.select(next.artifact_id, false)
      } else if (next.state === 'failed') error.value = imageJobError(next.error_code)
      if (!isTerminal(next)) schedulePoll()
    } catch (cause) {
      if (owner === epoch && !disposed) syncError.value = `任务状态同步中断：${errorText(cause)}`
    } finally {
      if (owner === epoch) polling = false
    }
  }

  function schedulePoll(): void {
    if (!disposed) poller.schedule(refreshJob)
  }

  async function cancel(): Promise<void> {
    if (
      !activeJob.value ||
      !hasActiveJob.value ||
      activeJob.value.state === 'cancelling' ||
      cancelling.value
    )
      return
    cancelling.value = true
    try {
      await deps.gateway.cancel(activeJob.value.id)
      await refreshJob()
    } catch (cause) {
      error.value = errorText(cause)
      await refreshJob()
    } finally {
      cancelling.value = false
    }
  }

  async function selectArtifact(id: string): Promise<void> {
    await history.select(id)
    const source = selectedArtifact.value?.reference_ids?.[0]
    if (source) await inputs.restoreInputs([source])
  }

  async function reuse(item: ImageArtifact | ImageJob): Promise<void> {
    if (hasActiveJob.value || submitting.value) return
    try {
      await restorer.restore(async () => {
        const ids = [...(item.reference_ids ?? []), ...(item.mask_id ? [item.mask_id] : [])]
        const available = await Promise.allSettled(ids.map((id) => deps.gateway.metadata(id)))
        return restoreImage(
          item,
          imageModels.value.map((model) => ({
            id: model.id,
            imageEditing: model.capabilities.imageEditing === true,
            inpainting: model.capabilities.inpainting === true,
          })),
          new Set(ids.filter((_, index) => available[index]?.status === 'fulfilled')),
        )
      })
      await inputs.restoreInputs()
    } catch (cause) {
      error.value = errorText(cause)
    }
  }
  async function editArtifact(): Promise<void> {
    const item = selectedArtifact.value
    if (
      !item ||
      hasActiveJob.value ||
      submitting.value ||
      inputs.uploading.value ||
      preparingEdit.value
    )
      return
    const model =
      imageModels.value.find(
        (entry) => entry.id === form.value.modelId && entry.capabilities.imageEditing,
      ) ??
      imageModels.value.find(
        (entry) => entry.source !== 'builtin' && entry.capabilities.imageEditing,
      )
    if (!model) {
      error.value = '请先导入支持图片编辑的完整模型。'
      return
    }
    const owner = epoch
    preparingEdit.value = true
    try {
      const blob = await deps.gateway.image(item.id, scope.signal)
      if (owner !== epoch || disposed) return
      form.value = {
        ...form.value,
        modelId: model.id,
        mode: 'edit',
        prompt: '',
        referenceIds: [],
        maskId: null,
        strength: 1,
        width: item.width,
        height: item.height,
        steps: 40,
      }
      await inputs.uploadReferences([new File([blob], '原作品.png', { type: 'image/png' })])
    } catch (cause) {
      if (owner === epoch && !disposed) error.value = errorText(cause)
    } finally {
      if (owner === epoch) preparingEdit.value = false
    }
  }

  function dispose(): void {
    restorer.dispose()
    history.dispose()
    disposed = true
    scope.abort()
    submitting.value = false
    preparingEdit.value = false
    cancelling.value = false
    epoch += 1
    poller.stop()
    polling = false

    inputs.disposeInputs()
  }

  return {
    ...inputs,
    restorePending: restorer.pending,
    restoreCandidate: restorer.candidate,
    restoreAdjustments: restorer.adjustments,
    applyRestoreCandidate: restorer.applyCandidate,
    editArtifact,
    preparingEdit,
    form,
    artifacts,
    jobs,
    activeJob,
    selectedId,
    urls,
    imageErrors,
    loading,
    historyLoading,
    submitting,
    cancelling,
    savingId,
    savingById: history.savingById,
    detailError: history.detailError,
    detailLoading: history.detailLoading,
    historyPhase: history.phase,
    error,
    historyError,
    syncError,
    hasMore,
    imageModels,
    modelError,
    selectedArtifact,
    hasActiveJob,
    loadWorkspace,
    loadHistory,
    loadImage,
    imageVisibility: history.visibility,
    async recycle() {
      const id = selectedId.value
      if (!id || !deps.gateway.recycle) return
      try {
        await deps.gateway.recycle(id)
        history.forget(id)
      } catch (cause) {
        error.value = errorText(cause)
      }
    },
    generate,
    refreshJob,
    cancel,
    selectArtifact,
    reuse,
    saveArtifact,
    dispose,
  }
}
function errorText(cause: unknown): string {
  return cause instanceof ImageValidationError
    ? (validationMessages[cause.code] ?? '图片参数无效')
    : cause instanceof Error
      ? cause.message
      : '图片工作区请求失败'
}
