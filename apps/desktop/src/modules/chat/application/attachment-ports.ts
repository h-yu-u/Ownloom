import type { AttachmentMetadata, DraftSelection, TextPreview } from '@mlx-studio/api-client'

export interface AttachmentGateway {
  upload(
    file: File,
    options: { uploadId: string; draftId: string; revision: number },
    signal?: AbortSignal,
  ): Promise<AttachmentMetadata>
  metadata(id: string, signal?: AbortSignal): Promise<AttachmentMetadata>
  retry(id: string): Promise<AttachmentMetadata>
  lease(id: string, value: DraftSelection): Promise<unknown>
  close(id: string): Promise<unknown>
  thumbnail(id: string, preparation: string, signal?: AbortSignal): Promise<Blob>
  original(id: string, signal?: AbortSignal): Promise<Blob>
  text(id: string, preparation: string, start?: number, signal?: AbortSignal): Promise<TextPreview>
}
