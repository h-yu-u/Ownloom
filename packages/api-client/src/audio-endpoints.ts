import type { components } from './generated-schema'
import type { Transport } from './transport/ports'
import { list } from './decoders'
import {
  decodeAudioArtifact,
  decodeAudioJob,
  decodeVoice,
  decodeAudioAsset,
} from './audio-decoders'
const root = '/internal/v1'
const path = encodeURIComponent
export function audioEndpoints(transport: Transport) {
  return {
    references: async (signal?: AbortSignal) =>
      list(await transport.get(`${root}/audio-assets`, signal), decodeAudioAsset),
    voices: async (signal?: AbortSignal) =>
      list(await transport.get(`${root}/voices`, signal), decodeVoice),
    createVoice: async (request: components['schemas']['VoiceCreate']) =>
      decodeVoice(await transport.post(`${root}/voices`, request)),
    updateVoice: async (id: string, request: components['schemas']['VoicePatch']) =>
      decodeVoice(await transport.patch(`${root}/voices/${path(id)}`, request)),
    deleteVoice: (id: string, deleteReference = false) =>
      transport.delete(`${root}/voices/${path(id)}?delete_reference=${deleteReference}`),
    deleteAsset: (id: string) => transport.delete(`${root}/audio-assets/${path(id)}`),
    generate: async (request: components['schemas']['AudioGenerationRequest']) =>
      decodeAudioJob(await transport.post(`${root}/audio-generations`, request)),
    jobs: async (signal?: AbortSignal) =>
      list(await transport.get(`${root}/audio-generations`, signal), decodeAudioJob),
    job: async (id: string, signal?: AbortSignal) =>
      decodeAudioJob(await transport.get(`${root}/audio-generations/${path(id)}`, signal)),
    cancel: (id: string) => transport.post(`${root}/audio-generations/${path(id)}/cancel`),
    artifact: async (id: string, signal?: AbortSignal) =>
      decodeAudioArtifact(await transport.get(`${root}/audio-artifacts/${path(id)}`, signal)),
    history: async (offset: number, signal?: AbortSignal) =>
      list(
        await transport.get(`${root}/audio-artifacts?limit=24&offset=${offset}`, signal),
        decodeAudioArtifact,
      ),
    deleteArtifact: (id: string) => transport.delete(`${root}/audio-artifacts/${path(id)}`),
  }
}
