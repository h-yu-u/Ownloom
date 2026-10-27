import type { AttachmentMetadata, components } from '@mlx-studio/api-client'
export type MediaSelection =
  | { kind: 'image-reference'; attachmentId: string }
  | { kind: 'image-artifact'; artifactId: string }
  | { kind: 'voice'; voiceId: string; displayedVersion: number }
  | { kind: 'audio-reference'; assetId: string }
export interface AssetOptionView {
  key: string
  name: string
  description?: string
  selectable: boolean
  disabledReason?: string
  selection: MediaSelection
}
export interface AssetCatalog {
  images(offset: number): Promise<components['schemas']['ImageArtifactView'][]>
  voices(): Promise<components['schemas']['VoiceView'][]>
  metadata(id: string): Promise<AttachmentMetadata>
  voiceContent(id: string): Promise<Blob>
  imageContent(id: string): Promise<Blob>
  attachmentContent(id: string): Promise<Blob>
  upload(
    file: File,
    identity: { uploadId: string; draftId: string; revision: number },
  ): Promise<AttachmentMetadata>
}
