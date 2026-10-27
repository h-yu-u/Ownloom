import { computed, ref } from 'vue'
import type { CodingSettings, ModelSummary } from '@mlx-studio/api-client'
import type { SaveOutcome } from '../../shared/lib/save-outcome'
export interface CodingSettingsGateway {
  load(): Promise<CodingSettings>
  save(value: CodingSettings): Promise<CodingSettings>
  models(): Promise<ModelSummary[]>
}
export function createCodingSettingsController(gateway: CodingSettingsGateway) {
  const settings = ref<CodingSettings>({
    id: 'coding',
    defaultModelId: '',
    contextBudget: 32768,
    maxRepairRounds: 2,
  })
  const draft = ref({ ...settings.value }),
    loaded = ref(false),
    models = ref<{ label: string; value: string }[]>([])
  const loadPending = ref(false),
    savePending = ref(false),
    error = ref<string | null>(null)
  const pending = computed(() => loadPending.value || savePending.value)
  const dirty = computed(
    () =>
      draft.value.defaultModelId !== settings.value.defaultModelId ||
      draft.value.contextBudget !== settings.value.contextBudget ||
      draft.value.maxRepairRounds !== settings.value.maxRepairRounds,
  )
  function reset(): void {
    draft.value = { ...settings.value }
  }
  async function load(): Promise<void> {
    if (pending.value) return
    const edited = dirty.value
    loadPending.value = true
    error.value = null
    try {
      const [value, items] = await Promise.all([gateway.load(), gateway.models()])
      settings.value = value
      loaded.value = true
      if (!edited) reset()
      models.value = items
        .filter((item) => item.outputModalities.includes('text'))
        .map((item) => ({ label: item.displayName, value: item.id }))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '读取 Coding 设置失败'
    } finally {
      loadPending.value = false
    }
  }
  async function save(): Promise<SaveOutcome<CodingSettings>> {
    if (pending.value || !loaded.value)
      return { kind: 'failed', message: '请先读取配置', retryable: true }
    if (
      !Number.isInteger(draft.value.contextBudget) ||
      draft.value.contextBudget < 4096 ||
      draft.value.contextBudget > 32768 ||
      !Number.isInteger(draft.value.maxRepairRounds) ||
      draft.value.maxRepairRounds < 0 ||
      draft.value.maxRepairRounds > 3
    ) {
      error.value = '请检查上下文预算和修复轮数'
      return { kind: 'invalid', fields: {}, message: error.value }
    }
    savePending.value = true
    error.value = null
    try {
      const saved = await gateway.save({ ...draft.value })
      settings.value = saved
      reset()
      return { kind: 'saved', value: saved }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存 Coding 设置失败'
      return { kind: 'failed', message: error.value, retryable: true }
    } finally {
      savePending.value = false
    }
  }
  return {
    settings,
    draft,
    models,
    pending,
    loadPending,
    savePending,
    loaded,
    dirty,
    error,
    load,
    save,
    reset,
  }
}
