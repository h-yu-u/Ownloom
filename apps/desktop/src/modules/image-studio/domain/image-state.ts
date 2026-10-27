export type ImageMode = 'generate' | 'edit' | 'inpaint'
export interface ImageEditFields {
  mode?: ImageMode
  reference_ids?: string[]
  mask_id?: string | null
  strength?: number
}
export interface ImageSnapshot extends ImageEditFields {
  model_id: string
  model_name: string
  prompt: string
  width: number
  height: number
  steps: number
  seed: number
  simulated: boolean
}
export interface ImageArtifact extends ImageSnapshot {
  id: string
  job_id: string
  created_at: number
}
export interface ImageJob extends ImageSnapshot {
  id: string
  state: 'queued' | 'preparing' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  created_at: number
  error_code: string | null
  artifact_id: string | null
}
export interface ImageRequest extends ImageEditFields {
  client_request_id?: string
  model_id: string
  prompt: string
  width: number
  height: number
  steps: number
  seed: number | null
}
export interface ImageDraft {
  modelId: string | null
  prompt: string
  width: number
  height: number
  steps: number
  seed: number | null
  mode?: ImageMode
  referenceIds?: string[]
  maskId?: string | null
  strength?: number
}
export function isTerminal(job: ImageJob): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(job.state)
}
export function buildImageRequest(draft: ImageDraft): ImageRequest {
  if (!draft.modelId) throw new ImageValidationError('IMAGE_MODEL_REQUIRED')
  if (!draft.prompt.trim() || draft.prompt.length > 10000)
    throw new ImageValidationError('IMAGE_PROMPT_INVALID')
  if (
    [draft.width, draft.height].some(
      (value) => !Number.isInteger(value) || value < 64 || value > 2048 || value % 16,
    )
  ) {
    throw new ImageValidationError('IMAGE_DIMENSIONS_INVALID')
  }
  if (!Number.isInteger(draft.steps) || draft.steps < 1 || draft.steps > 100)
    throw new ImageValidationError('IMAGE_STEPS_INVALID')
  if (
    draft.seed !== null &&
    (!Number.isInteger(draft.seed) || draft.seed < 0 || draft.seed > 4294967295)
  ) {
    throw new ImageValidationError('IMAGE_SEED_INVALID')
  }
  const edit = buildEditFields(draft)
  return {
    model_id: draft.modelId,
    prompt: draft.prompt.trim(),
    width: draft.width,
    height: draft.height,
    steps: draft.steps,
    seed: draft.seed,
    ...edit,
  }
}

function buildEditFields(draft: ImageDraft): ImageEditFields {
  const mode = draft.mode ?? 'generate'
  if (mode === 'generate') return {}
  const ids = draft.referenceIds ?? []
  if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length)
    throw new ImageValidationError('IMAGE_REFERENCE_REQUIRED')
  if (mode === 'inpaint' && !draft.maskId) throw new ImageValidationError('IMAGE_MASK_REQUIRED')
  const strength = draft.strength ?? 1
  if (!Number.isFinite(strength) || strength <= 0 || strength > 1)
    throw new ImageValidationError('IMAGE_EDIT_PARAMETERS_INVALID')
  if (draft.width % 32 || draft.height % 32)
    throw new ImageValidationError('IMAGE_EDIT_DIMENSIONS_INVALID')
  return {
    mode,
    reference_ids: [...ids],
    mask_id: mode === 'inpaint' ? draft.maskId : null,
    strength,
  }
}

export class ImageValidationError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
