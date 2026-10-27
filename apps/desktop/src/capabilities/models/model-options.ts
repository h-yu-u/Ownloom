import { deriveTaskReadiness } from './task-readiness'
import type { ModelSummary } from './directory'
export interface ModelOptionView {
  id: string
  label: string
  capabilityLabel: string
  availability: 'available' | 'unavailable'
  disabledReason?: string
}
export function modelOptions(
  models: readonly ModelSummary[],
  modality: 'text' | 'image' | 'audio',
): ModelOptionView[] {
  return models
    .filter((model) => model.outputModalities.includes(modality))
    .map((model) => {
      const readiness = deriveTaskReadiness(model, { available: true }, { output: modality })
      const reason =
        readiness.blockers[0]?.recovery ??
        (model.engine === 'unknown'
          ? '模型架构尚未适配'
          : (model.speech?.unavailableReason ?? undefined))
      return {
        id: model.id,
        label: model.displayName,
        capabilityLabel: model.state === 'loaded' ? '已加载' : '选择后由任务准备',
        availability: reason ? 'unavailable' : 'available',
        disabledReason: reason,
      }
    })
}
