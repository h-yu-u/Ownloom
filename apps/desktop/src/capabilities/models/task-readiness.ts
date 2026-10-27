import type { ModelSummary } from './directory'

export interface TaskReadiness {
  submitAllowed: boolean
  dispatch: 'immediate' | 'queue' | 'prepare'
  blockers: { code: string; recovery: string }[]
  warnings: { code: string; detail: string }[]
  capabilityEvidence: 'verified' | 'unverified' | 'unsupported'
}

export function deriveTaskReadiness(
  model: ModelSummary | undefined,
  runtime: {
    available: boolean
    busy?: boolean
    memoryAvailableBytes?: number | null
    estimatedModelBytes?: number | null
  },
  requirements: { output: 'text' | 'image' | 'audio'; vision?: boolean; tools?: boolean },
  selection: { toolsVerified?: boolean; allowTrial?: boolean } = {},
): TaskReadiness {
  const blockers: TaskReadiness['blockers'] = [],
    warnings: TaskReadiness['warnings'] = []
  if (!model) blockers.push({ code: 'MODEL_NOT_FOUND', recovery: '请选择兼容的本地模型' })
  if (!runtime.available)
    blockers.push({ code: 'RUNTIME_NOT_AVAILABLE', recovery: '重新连接 Runtime' })
  if (model) {
    if (!model.outputModalities.includes(requirements.output) || model.engine === 'unknown')
      blockers.push({ code: 'MODEL_CAPABILITY_INVALID', recovery: '选择支持此任务的模型' })
    if (requirements.vision && !model.inputModalities.includes('image'))
      blockers.push({ code: 'MODEL_INPUT_UNSUPPORTED', recovery: '更换视觉模型或移除图片' })
    if (!['available', 'loaded', 'loading'].includes(model.state))
      blockers.push({ code: 'MODEL_NOT_READY', recovery: '完成下载或重试加载模型' })
    if (requirements.tools && !selection.toolsVerified) {
      if (selection.allowTrial)
        warnings.push({ code: 'MODEL_TOOLS_UNVERIFIED', detail: '将先验证工具能力' })
      else blockers.push({ code: 'MODEL_TOOLS_UNVERIFIED', recovery: '先验证模型工具能力' })
    }
  }
  if (runtime.memoryAvailableBytes == null || runtime.estimatedModelBytes == null)
    warnings.push({ code: 'MEMORY_ESTIMATE_UNKNOWN', detail: '内存估计未知，以实际加载结果为准' })
  else if (runtime.estimatedModelBytes > runtime.memoryAvailableBytes)
    warnings.push({
      code: 'MEMORY_ESTIMATE_HIGH',
      detail: '预计模型占用超过可用内存，加载可能失败',
    })
  return {
    submitAllowed: !blockers.length,
    dispatch: runtime.busy ? 'queue' : model?.state === 'loaded' ? 'immediate' : 'prepare',
    blockers,
    warnings,
    capabilityEvidence: blockers.some((item) => item.code.includes('UNSUPPORTED'))
      ? 'unsupported'
      : selection.toolsVerified || !requirements.tools
        ? 'verified'
        : 'unverified',
  }
}
