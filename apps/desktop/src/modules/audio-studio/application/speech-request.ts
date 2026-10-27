import type { AudioJob, SpeechDraft, SpeechModel, SpeechRequest } from './ports'
export const terminal = (job: AudioJob): boolean =>
  ['succeeded', 'cancelled', 'failed'].includes(job.state)
export function compatibleModels(
  models: readonly SpeechModel[],
  mode: SpeechDraft['mode'],
): SpeechModel[] {
  return models.filter(
    (model) =>
      model.task === 'text-to-speech' &&
      model.speech?.operations.some((operation) => operation.mode === mode),
  )
}
export function buildSpeechRequest(
  draft: SpeechDraft,
  models: readonly SpeechModel[],
): Omit<SpeechRequest, 'clientRequestId'> {
  const model = compatibleModels(models, draft.mode).find((item) => item.id === draft.modelId)
  const operation = model?.speech?.operations.find((op) => op.mode === draft.mode)
  if (!model || !operation) throw new Error('请先选择支持此模式的语音模型。')
  if (!draft.text.trim() || Array.from(draft.text).length > operation.maxTextCharacters)
    throw new Error(`请输入 1–${operation.maxTextCharacters} 字的朗读文字。`)
  if (!operation.languages.includes(draft.language)) throw new Error('请选择模型支持的语言。')
  if (
    draft.mode === 'preset' &&
    (!draft.speaker || !operation.presetSpeakers.includes(draft.speaker))
  )
    throw new Error('请选择模型提供的预设音色。')
  if (draft.mode === 'clone' && !draft.voiceId) throw new Error('请先导入参考音频并保存音色。')
  return {
    modelId: model.id,
    mode: draft.mode,
    text: draft.text.trim(),
    language: draft.language,
    ...(draft.mode === 'preset' ? { speaker: draft.speaker } : { voiceId: draft.voiceId }),
    output: { format: 'wav' },
  }
}

export function deriveSpeechReadiness(
  draft: SpeechDraft,
  models: readonly SpeechModel[],
  voices: readonly { id: string }[],
) {
  const fields: Record<string, string> = {}
  try {
    buildSpeechRequest(draft, models)
  } catch (cause) {
    fields.form = cause instanceof Error ? cause.message : '请检查语音参数'
  }
  if (draft.mode === 'clone' && !voices.some((voice) => voice.id === draft.voiceId))
    fields.voiceId = '请选择参考音色'
  return { canSubmit: !Object.keys(fields).length, fields }
}
