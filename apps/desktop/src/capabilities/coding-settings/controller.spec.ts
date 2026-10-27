import { describe, expect, it, vi } from 'vitest'
import type { CodingSettings } from '@mlx-studio/api-client'
import { createCodingSettingsController } from './controller'
describe('coding settings drafts', () => {
  it('does not expose unsaved defaults or fabricate a server revision, and retains failed edits', async () => {
    const saved = {
      id: 'coding' as const,
      defaultModelId: 'original',
      contextBudget: 8192,
      maxRepairRounds: 2,
    }
    const gateway = {
      load: async () => saved,
      models: async () => [],
      save: vi.fn(async (value: CodingSettings) => value),
    }
    const state = createCodingSettingsController(gateway)
    await state.load()
    state.draft.value.defaultModelId = 'new'
    expect(state.settings.value.defaultModelId).toBe('original')
    gateway.save.mockRejectedValueOnce(new Error('offline'))
    expect((await state.save()).kind).toBe('failed')
    expect(state.draft.value.defaultModelId).toBe('new')
    expect(state.settings.value.defaultModelId).toBe('original')
    expect((await state.save()).kind).toBe('saved')
    expect(gateway.save).toHaveBeenLastCalledWith({ ...saved, defaultModelId: 'new' })
  })
})
