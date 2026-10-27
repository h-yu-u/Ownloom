import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { AttachmentGateway } from '../application/attachment-ports'

export function createAttachmentGateway(provider: () => Promise<RuntimeClient>): AttachmentGateway {
  const endpoints = async () => createEndpoints(await provider()).attachments
  return {
    upload: async (file, options, signal) =>
      (await provider()).uploadAttachment(file, options, signal),
    metadata: async (id, signal) => (await endpoints()).metadata(id, signal),
    retry: async (id) => (await endpoints()).retry(id),
    lease: async (id, value) => (await endpoints()).lease(id, value),
    close: async (id) => (await endpoints()).close(id),
    text: async (id, preparation, start, signal) =>
      (await endpoints()).text(id, preparation, start, signal),
    thumbnail: async (id, preparation, signal) =>
      (await provider()).attachmentThumbnail(id, preparation, signal),
    original: async (id, signal) => (await provider()).downloadAttachment(id, signal),
  }
}
