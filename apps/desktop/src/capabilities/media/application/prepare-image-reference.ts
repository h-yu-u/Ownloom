import type { AttachmentMetadata } from '@mlx-studio/api-client'
import type { AssetCatalog } from './asset-catalog'
export async function prepareImageReference(
  input: { artifactId: string; uploadId: string; draftId: string; revision: number },
  ports: Pick<AssetCatalog, 'imageContent' | 'upload'>,
): Promise<AttachmentMetadata> {
  const blob = await ports.imageContent(input.artifactId)
  return ports.upload(
    new File([blob], `image-${input.artifactId}.png`, { type: 'image/png' }),
    input,
  )
}
