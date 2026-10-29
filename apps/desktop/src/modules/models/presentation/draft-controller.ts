import { ref } from 'vue'
import type { ModelSummary, components } from '@mlx-studio/api-client'
import type { ModelsGateway } from '../application/ports'

type Settings = components['schemas']['DraftSettingsRequest']
export function initialDraft(model?: ModelSummary): Settings {
  return (
    model?.draft ?? {
      enabled: !!model?.mtp,
      mode: model?.mtp ? 'mtp' : 'auto',
      mtpPath: model?.mtp?.draftPath ?? null,
      dflashPath: null,
      mtpBlockSize: model?.mtp?.blockSize ?? 3,
      dflashBlockSize: 5,
    }
  )
}

export function createDraftController(deps: {
  gateway: ModelsGateway
  pickDirectory(): Promise<string | null>
  refresh(): Promise<void>
}) {
  const draftModel = ref<ModelSummary | null>(null)
  const draftSettings = ref<Settings>(initialDraft())
  const draftSaving = ref(false)
  const draftError = ref<string | null>(null)
  let generation = 0

  function showDraft(model: ModelSummary): void {
    if (draftSaving.value) return
    generation += 1
    draftModel.value = model
    draftSettings.value = { ...initialDraft(model) }
    draftError.value = null
  }
  function closeDraft(): void {
    if (draftSaving.value) return
    generation += 1
    draftModel.value = null
  }
  async function pickDraftDirectory(kind: 'mtp' | 'dflash2'): Promise<void> {
    const ticket = ++generation
    try {
      const path = await deps.pickDirectory()
      if (ticket !== generation || !draftModel.value || draftSaving.value) return
      if (path)
        draftSettings.value = {
          ...draftSettings.value,
          [kind === 'mtp' ? 'mtpPath' : 'dflashPath']: path,
        }
    } catch (cause) {
      if (ticket === generation && draftModel.value) {
        draftError.value = cause instanceof Error ? cause.message : '选择目录失败'
      }
    }
  }
  async function saveDraft(): Promise<boolean> {
    const model = draftModel.value
    if (!model || draftSaving.value) return false
    const settings = {
      ...draftSettings.value,
      mtpPath: draftSettings.value.mtpPath?.trim() || null,
      dflashPath: draftSettings.value.dflashPath?.trim() || null,
    }
    if (
      settings.enabled &&
      ((settings.mode !== 'dflash2' && !settings.mtpPath) ||
        (settings.mode !== 'mtp' && !settings.dflashPath))
    ) {
      draftError.value = '请选择所用方案的本地草稿目录'
      return false
    }
    generation += 1
    draftSaving.value = true
    draftError.value = null
    try {
      await deps.gateway.configureDraft(model.id, settings)
      await deps.refresh()
      draftModel.value = null
      return true
    } catch (cause) {
      draftError.value = cause instanceof Error ? cause.message : '草稿设置保存失败'
      return false
    } finally {
      draftSaving.value = false
    }
  }
  return {
    draftModel,
    draftSettings,
    draftSaving,
    draftError,
    showDraft,
    closeDraft,
    pickDraftDirectory,
    saveDraft,
  }
}
