import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { ImageRequest } from '../domain/image-state'
export function createImageGateway(provider: () => Promise<RuntimeClient>) {
  const endpoints = async () => createEndpoints(await provider()).images
  return {
    recycle: async (id: string) =>
      (await provider()).delete(`/internal/v1/image-artifacts/${encodeURIComponent(id)}`),
    listJobs: async (signal?: AbortSignal) => (await endpoints()).listJobs(signal),
    artifact: async (id: string, signal?: AbortSignal) => (await endpoints()).artifact(id, signal),
    history: async (offset: number, signal?: AbortSignal) =>
      (await endpoints()).history(offset, signal),
    generate: async (request: ImageRequest) =>
      (await endpoints()).generate({
        ...request,
        mode: request.mode ?? 'generate',
        strength: request.strength ?? 1,
      }),
    job: async (id: string, signal?: AbortSignal) => (await endpoints()).job(id, signal),
    cancel: async (id: string) => (await endpoints()).cancel(id),
    thumbnail: async (id: string, signal?: AbortSignal) =>
      (await provider()).downloadImageArtifact(id, signal, true),
    image: async (id: string, signal?: AbortSignal) =>
      (await provider()).downloadImageArtifact(id, signal),
    upload: async (file: File) => (await provider()).uploadImage(file),
    metadata: async (id: string, signal?: AbortSignal) =>
      createEndpoints(await provider()).attachments.metadata(id, signal),
    attachment: async (id: string, signal?: AbortSignal) =>
      (await provider()).downloadAttachment(id, signal),
  }
}
