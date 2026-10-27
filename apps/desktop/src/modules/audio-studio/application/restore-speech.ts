import type { AudioArtifact, AudioJob, SpeechDraft, SpeechModel, Voice } from './ports'
import type { RestoreNotice } from '../../../shared/lib/restore-notice'
import { compatibleModels } from './speech-request'
export function restoreSpeech(
  item: AudioArtifact | AudioJob,
  models: readonly SpeechModel[],
  voices: readonly Voice[],
) {
  const adjustments: RestoreNotice[] = [],
    model = compatibleModels(models, item.mode).find((entry) => entry.id === item.model_id)
  const operation = model?.speech?.operations.find((op) => op.mode === item.mode),
    voice = voices.find((entry) => entry.id === item.voice_id)
  const draft: SpeechDraft = {
    modelId: model?.id ?? null,
    mode: item.mode,
    text: item.text,
    language: item.language,
    speaker: item.speaker,
    voiceId: voice?.id ?? null,
  }
  if (!model)
    adjustments.push({
      code: 'model-missing',
      message: `原模型「${item.model_name}」不存在或不支持此模式，请重新选择`,
      blocking: true,
    })
  if (operation && !operation.languages.includes(item.language))
    adjustments.push({
      code: 'language-unsupported',
      message: `原语言 ${item.language} 不受支持，请重新选择`,
      blocking: true,
    })
  if (item.mode === 'preset' && operation && !operation.presetSpeakers.includes(item.speaker ?? ''))
    adjustments.push({
      code: 'speaker-unavailable',
      message: '原预设音色不受支持，请重新选择',
      blocking: true,
    })
  if (item.mode === 'clone' && !voice)
    adjustments.push({
      code: 'voice-missing',
      message: '原音色已删除，请选择或创建音色',
      blocking: true,
    })
  if (voice && item.voice_snapshot && voice.version !== item.voice_snapshot.version) {
    const before = item.voice_snapshot
    const changed =
      before.reference_asset_id !== voice.reference_asset_id ||
      before.reference_text !== voice.reference_text ||
      before.language !== voice.language
    adjustments.push({
      code: changed ? 'voice-changed' : 'voice-renamed',
      resourceId: voice.id,
      message: changed
        ? `音色已从 v${before.version} 更新为 v${voice.version}，请确认使用当前版本`
        : '音色名称已更新，参考内容保持一致',
      blocking: changed,
    })
  }
  return { draft, adjustments, canSubmit: !adjustments.some((item) => item.blocking) }
}
