import type { components } from './generated-schema'
import { list, malformed, nullableText, number, record, text } from './decoders'
type Schemas = components['schemas']

function choice<T extends string>(value: unknown, values: readonly T[]): T {
  const found = values.find((item) => item === value)
  if (found === undefined) throw malformed()
  return found
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw malformed()
  return value
}
export function decodeSpeech(value: unknown): Schemas['SpeechCapabilitiesView'] | null {
  if (value === null || value === undefined) return null
  const item = record(value)
  return {
    family: text(item.family),
    variant: text(item.variant),
    verification: choice(item.verification, ['candidate', 'validated']),
    adapterVersion: text(item.adapterVersion),
    unavailableReason: nullableText(item.unavailableReason),
    operations: list(item.operations, (value) => {
      const op = record(value)
      return {
        mode: choice(op.mode, ['preset', 'clone']),
        referenceAudio: choice(op.referenceAudio, ['required', 'unsupported']),
        referenceText: choice(op.referenceText, ['required', 'unsupported']),
        stylePrompt: boolean(op.stylePrompt),
        streamKind: choice(op.streamKind, ['none']),
        languages: list(op.languages, text),
        presetSpeakers: list(op.presetSpeakers, text),
        maxTextCharacters: number(op.maxTextCharacters),
        maxReferenceSeconds: number(op.maxReferenceSeconds),
      }
    }),
  }
}
export function decodeVoice(value: unknown): Schemas['VoiceView'] {
  const item = record(value)
  if (item.consent !== true) throw malformed()
  return {
    id: text(item.id),
    name: text(item.name),
    reference_asset_id: text(item.reference_asset_id),
    reference_text: text(item.reference_text),
    language: text(item.language),
    source: choice(item.source, ['self', 'authorized', 'generated']),
    consent: true,
    version: number(item.version),
    created_at: number(item.created_at),
    consent_at: number(item.consent_at),
  }
}
export function decodeAudioAsset(value: unknown): Schemas['AudioAssetView'] {
  const item = record(value)
  return {
    id: text(item.id),
    original_name: text(item.original_name),
    role: choice(item.role, ['reference', 'generated']),
    sha256: text(item.sha256),
    format: choice(item.format, ['wav']),
    size_bytes: number(item.size_bytes),
    sample_rate: number(item.sample_rate),
    channels: number(item.channels),
    duration_seconds: number(item.duration_seconds),
    peaks: list(item.peaks, number),
    created_at: number(item.created_at),
  }
}
function snapshot(item: Record<string, unknown>) {
  return {
    model_id: text(item.model_id),
    model_name: text(item.model_name),
    model_revision: nullableText(item.model_revision),
    model_identity: nullableText(item.model_identity),
    adapter_version: text(item.adapter_version),
    mode: choice(item.mode, ['preset', 'clone']),
    text: text(item.text),
    language: text(item.language),
    speaker: nullableText(item.speaker),
    voice_id: nullableText(item.voice_id),
    voice_snapshot: item.voice_snapshot === null ? null : decodeVoice(item.voice_snapshot),
    simulated: boolean(item.simulated),
  }
}
export function decodeAudioJob(value: unknown): Schemas['AudioJobView'] {
  const item = record(value)
  return {
    ...snapshot(item),
    id: text(item.id),
    created_at: number(item.created_at),
    state: choice(item.state, [
      'queued',
      'preparing',
      'running',
      'cancelling',
      'succeeded',
      'failed',
      'cancelled',
    ]),
    error_code: nullableText(item.error_code),
    artifact_id: nullableText(item.artifact_id),
  }
}
export function decodeAudioArtifact(value: unknown): Schemas['AudioArtifactView'] {
  const item = record(value)
  return {
    ...snapshot(item),
    id: text(item.id),
    job_id: text(item.job_id),
    asset_id: text(item.asset_id),
    created_at: number(item.created_at),
    sample_rate: number(item.sample_rate),
    channels: number(item.channels),
    duration_seconds: number(item.duration_seconds),
    peaks: list(item.peaks, number),
    elapsed_seconds: number(item.elapsed_seconds),
    rtf: number(item.rtf),
  }
}
