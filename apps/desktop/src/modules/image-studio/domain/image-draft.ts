import type { ImageDraft, ImageSnapshot } from './image-state'

export function createImageDraft(item?: ImageSnapshot, modelIds: string[] = []): ImageDraft {
  if (!item)
    return {
      modelId: null,
      prompt: '',
      width: 512,
      height: 512,
      steps: 20,
      seed: null,
      mode: 'generate',
      referenceIds: [],
      maskId: null,
      strength: 1,
    }
  return {
    modelId: modelIds.includes(item.model_id) ? item.model_id : null,
    prompt: item.prompt,
    width: item.width,
    height: item.height,
    steps: item.steps,
    seed: item.seed,
    mode: item.mode ?? 'generate',
    referenceIds: [...(item.reference_ids ?? [])],
    maskId: item.mask_id ?? null,
    strength: item.strength ?? 1,
  }
}
