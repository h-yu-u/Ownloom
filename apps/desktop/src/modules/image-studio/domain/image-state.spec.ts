import { decodeImageJob as readJob } from '@mlx-studio/api-client'
import { describe, expect, it } from 'vitest'
import { buildImageRequest, type ImageDraft } from './image-state'

const draft: ImageDraft = {
  modelId: 'image-model',
  prompt: '  a lake  ',
  width: 512,
  height: 512,
  steps: 20,
  seed: 0,
}
describe('image generation requests', () => {
  it('preserves Seed zero and builds a trimmed reproducible snapshot without mutating the draft', () => {
    expect(buildImageRequest(draft)).toEqual({
      model_id: 'image-model',
      prompt: 'a lake',
      width: 512,
      height: 512,
      steps: 20,
      seed: 0,
    })
    expect(draft.prompt).toBe('  a lake  ')
    expect(buildImageRequest({ ...draft, seed: null }).seed).toBeNull()
  })
  it('rejects invalid models, dimensions, steps and seeds before submission', () => {
    for (const invalid of [
      { modelId: null },
      { width: 513 },
      { height: 32 },
      { steps: 101 },
      { seed: -1 },
      { prompt: '  ' },
    ]) {
      expect(() => buildImageRequest({ ...draft, ...invalid })).toThrow()
    }
  })
  it('rejects unknown task states instead of leaving an indefinite loading state', () => {
    expect(() => readJob({ state: 'unknown' })).toThrow('图片任务状态无效')
  })
})
