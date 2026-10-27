import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { AudioGateway } from '../application/ports'
export function createAudioGateway(provider: () => Promise<RuntimeClient>): AudioGateway {
  const endpoint = async () => createEndpoints(await provider()).audio
  return {
    references: async (signal) => (await endpoint()).references(signal),
    voices: async (signal) => (await endpoint()).voices(signal),
    createVoice: async (input) => (await endpoint()).createVoice(input),
    updateVoice: async (id, input) => (await endpoint()).updateVoice(id, input),
    deleteVoice: async (id, complete) => (await endpoint()).deleteVoice(id, complete),
    deleteAsset: async (id) => (await endpoint()).deleteAsset(id),
    upload: async (file) => (await provider()).uploadAudio(file),
    generate: async (input) => (await endpoint()).generate(input),
    jobs: async (signal) => (await endpoint()).jobs(signal),
    job: async (id, signal) => (await endpoint()).job(id, signal),
    cancel: async (id) => (await endpoint()).cancel(id),
    artifact: async (id: string, signal?: AbortSignal) => (await endpoint()).artifact(id, signal),
    history: async (offset, signal) => (await endpoint()).history(offset, signal),
    deleteArtifact: async (id) => (await endpoint()).deleteArtifact(id),
    audio: async (id, signal) => (await provider()).downloadAudio(id, 'artifact', signal),
    reference: async (id, signal) => (await provider()).downloadAudio(id, 'asset', signal),
  }
}
