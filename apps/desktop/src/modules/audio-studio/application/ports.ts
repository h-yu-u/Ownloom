import type { components, ModelSummary } from '@mlx-studio/api-client'
type Schemas = components['schemas']
export type AudioJob = Schemas['AudioJobView']
export type AudioArtifact = Schemas['AudioArtifactView']
export type AudioAsset = Schemas['AudioAssetView']
export type Voice = Schemas['VoiceView']
export type VoiceInput = Schemas['VoiceCreate']
export type VoicePatch = Schemas['VoicePatch']
export type SpeechRequest = Schemas['AudioGenerationRequest']
export type SpeechMode = SpeechRequest['mode']
export type SpeechModel = ModelSummary
export interface SpeechDraft {
  modelId: string | null
  mode: SpeechMode
  text: string
  language: string
  speaker: string | null
  voiceId: string | null
}
export interface AudioGateway {
  references(signal?: AbortSignal): Promise<AudioAsset[]>
  voices(signal?: AbortSignal): Promise<Voice[]>
  createVoice(input: VoiceInput): Promise<Voice>
  updateVoice(id: string, input: VoicePatch): Promise<Voice>
  deleteVoice(id: string, deleteReference?: boolean): Promise<unknown>
  deleteAsset(id: string): Promise<unknown>
  upload(file: File): Promise<AudioAsset>
  generate(request: SpeechRequest): Promise<AudioJob>
  jobs(signal?: AbortSignal): Promise<AudioJob[]>
  job(id: string, signal?: AbortSignal): Promise<AudioJob>
  cancel(id: string): Promise<unknown>
  artifact(id: string, signal?: AbortSignal): Promise<AudioArtifact>
  history(offset: number, signal?: AbortSignal): Promise<AudioArtifact[]>
  deleteArtifact(id: string): Promise<unknown>
  audio(id: string, signal?: AbortSignal): Promise<Blob>
  reference(id: string, signal?: AbortSignal): Promise<Blob>
}
