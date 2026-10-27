import { RuntimeError } from './errors'
import type { components } from './generated-schema'
import type { Transport } from './transport/ports'
type ImageArtifact = components['schemas']['ImageArtifactView']
type ImageJob = components['schemas']['ImageJobView']
const states = [
  'queued',
  'preparing',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
] as const
export function readArtifact(value: unknown): ImageArtifact {
  const item = record(value)
  return {
    ...snapshot(item),
    id: text(item, 'id'),
    job_id: text(item, 'job_id'),
    created_at: integer(item, 'created_at'),
  }
}
export function readJob(value: unknown): ImageJob {
  const item = record(value)
  const state = states.find((state) => state === item.state)
  if (!state) throw new RuntimeError('图片任务状态无效', 'RESPONSE_INVALID')
  if (integer(item, 'progress') > 100) throw new RuntimeError('图片进度无效', 'RESPONSE_INVALID')
  return {
    ...snapshot(item),
    id: text(item, 'id'),
    created_at: integer(item, 'created_at'),
    state,
    progress: integer(item, 'progress'),
    error_code: nullableText(item, 'error_code'),
    artifact_id: nullableText(item, 'artifact_id'),
  }
}
export function readList<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new RuntimeError('图片工作区响应格式无效', 'RESPONSE_INVALID')
  return value.map(read)
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RuntimeError('图片数据格式无效', 'RESPONSE_INVALID')
  return value as Record<string, unknown>
}
function snapshot(
  item: Record<string, unknown>,
): Omit<ImageArtifact, 'id' | 'job_id' | 'created_at'> {
  if (typeof item.simulated !== 'boolean')
    throw new RuntimeError('图片元数据格式无效', 'RESPONSE_INVALID')
  return {
    model_id: text(item, 'model_id'),
    model_name: text(item, 'model_name'),
    prompt: text(item, 'prompt'),
    width: integer(item, 'width'),
    height: integer(item, 'height'),
    steps: integer(item, 'steps'),
    seed: integer(item, 'seed'),
    simulated: item.simulated,
    ...editSnapshot(item),
  }
}
function editSnapshot(item: Record<string, unknown>) {
  const mode = item.mode ?? 'generate'
  const reference_ids = item.reference_ids ?? []
  const mask_id = item.mask_id ?? null
  const strength = item.strength ?? 1
  if (
    !['generate', 'edit', 'inpaint'].includes(String(mode)) ||
    !Array.isArray(reference_ids) ||
    reference_ids.length > 10 ||
    reference_ids.some((id) => typeof id !== 'string') ||
    (mask_id !== null && typeof mask_id !== 'string') ||
    typeof strength !== 'number' ||
    !Number.isFinite(strength) ||
    strength <= 0 ||
    strength > 1
  )
    throw new RuntimeError('图片编辑元数据无效', 'RESPONSE_INVALID')
  return {
    mode: mode as 'generate' | 'edit' | 'inpaint',
    reference_ids: reference_ids as string[],
    mask_id,
    strength,
  }
}
function text(item: Record<string, unknown>, key: string): string {
  const value = item[key]
  if (typeof value !== 'string') throw new RuntimeError('图片元数据格式无效', 'RESPONSE_INVALID')
  return value
}
function nullableText(item: Record<string, unknown>, key: string): string | null {
  return item[key] === null ? null : text(item, key)
}
function integer(item: Record<string, unknown>, key: string): number {
  const value = item[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new RuntimeError('图片参数格式无效', 'RESPONSE_INVALID')
  return value
}

export function imageEndpoints(transport: Transport) {
  return {
    listJobs: async (signal?: AbortSignal) =>
      readList(await transport.get('/internal/v1/image-jobs', signal), readJob),
    artifact: async (id: string, signal?: AbortSignal) =>
      readArtifact(
        await transport.get(`/internal/v1/image-artifacts/${encodeURIComponent(id)}`, signal),
      ),
    history: async (offset: number, signal?: AbortSignal) =>
      readList(
        await transport.get(`/internal/v1/image-artifacts?limit=24&offset=${offset}`, signal),
        readArtifact,
      ),
    generate: async (request: components['schemas']['ImageJobRequest']) =>
      readJob(await transport.post('/internal/v1/image-jobs', request)),
    job: async (id: string, signal?: AbortSignal) =>
      readJob(await transport.get(`/internal/v1/image-jobs/${encodeURIComponent(id)}`, signal)),
    cancel: async (id: string) =>
      transport.post(`/internal/v1/image-jobs/${encodeURIComponent(id)}/cancel`),
  }
}
