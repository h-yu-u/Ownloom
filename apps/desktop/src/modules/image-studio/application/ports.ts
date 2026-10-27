import type { ImageArtifact, ImageJob, ImageRequest } from '../domain/image-state'
export interface ImageGateway {
  recycle?(id: string): Promise<unknown>
  listJobs(signal?: AbortSignal): Promise<ImageJob[]>
  artifact(id: string, signal?: AbortSignal): Promise<ImageArtifact>
  history(offset: number, signal?: AbortSignal): Promise<ImageArtifact[]>
  generate(request: ImageRequest): Promise<ImageJob>
  job(id: string, signal?: AbortSignal): Promise<ImageJob>
  cancel(id: string): Promise<unknown>
  thumbnail?(id: string, signal?: AbortSignal): Promise<Blob>
  image(id: string, signal?: AbortSignal): Promise<Blob>
  upload(file: File): Promise<{ id: string; originalName: string }>
  metadata(
    id: string,
    signal?: AbortSignal,
  ): Promise<import('@mlx-studio/api-client').AttachmentMetadata>
  attachment(id: string, signal?: AbortSignal): Promise<Blob>
}
