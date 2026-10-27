import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { AssetCatalog } from '../application/asset-catalog'
export function createAssetCatalog(provider: () => Promise<RuntimeClient>): AssetCatalog {
  const endpoints = async () => createEndpoints(await provider())
  return {
    images: async (offset) => (await endpoints()).images.history(offset),
    voices: async () => (await endpoints()).audio.voices(),
    metadata: async (id) => (await endpoints()).attachments.metadata(id),
    voiceContent: async (id) => (await provider()).downloadAudio(id, 'asset'),
    imageContent: async (id) => (await provider()).downloadImageArtifact(id),
    attachmentContent: async (id) => (await provider()).downloadAttachment(id),
    upload: async (file, identity) => (await provider()).uploadAttachment(file, identity),
  }
}
