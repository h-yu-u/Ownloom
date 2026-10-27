import { describe, expect, it, vi } from 'vitest'
import { createWebSearchController } from './controller'
const saved = {
  id: 'web',
  revision: 2,
  provider: 'tavily' as const,
  baseUrl: 'https://saved.example',
  credentialConfigured: true,
  ready: true,
}
describe('web settings commits and verification', () => {
  it('preserves failed edits, blocks testing dirty values, then tests the committed revision', async () => {
    const gateway = {
      get: vi.fn(async () => saved),
      save: vi.fn(async () => ({ ...saved, revision: 3, baseUrl: 'https://new.example' })),
      test: vi.fn(async () => ({ ...saved, revision: 3, ok: true, elapsedMs: 42 })),
    }
    const state = createWebSearchController(gateway)
    await state.load()
    state.baseUrl.value = 'https://new.example'
    state.apiKey.value = 'secret-fixture'
    expect(await state.test()).toBe(false)
    expect(gateway.test).not.toHaveBeenCalled()
    gateway.save.mockRejectedValueOnce(new Error('save failed'))
    expect((await state.save()).kind).toBe('failed')
    expect(state.apiKey.value).toBe('secret-fixture')
    expect(state.settings.value?.revision).toBe(2)
    expect((await state.save()).kind).toBe('saved')
    expect(state.apiKey.value).toBe('')
    expect(state.dirty.value).toBe(false)
    await state.test()
    expect(gateway.test).toHaveBeenCalledWith('web', 3)
    expect(state.verification.value).toMatchObject({ kind: 'passed', revision: 3, elapsedMs: 42 })
  })
  it('treats a new test failure as failure despite a persisted historical ready flag', async () => {
    const state = createWebSearchController({
      get: async () => saved,
      save: async () => saved,
      test: async () => {
        throw new Error('offline')
      },
    })
    await state.load()
    expect(await state.test()).toBe(false)
    expect(state.verification.value).toMatchObject({ kind: 'failed', revision: 2 })
    expect(state.settings.value?.ready).toBe(true)
  })
  it('preserves successful snippet-only diagnostics instead of showing a connection failure', async () => {
    const state = createWebSearchController({
      get: async () => saved,
      save: async () => saved,
      test: async () => ({
        ...saved,
        ok: true,
        elapsedMs: 120,
        partial: true,
        sourceCount: 3,
        readCount: 0,
      }),
    })
    await state.load()
    expect(await state.test()).toBe(true)
    expect(state.error.value).toBe('')
    expect(state.verification.value).toMatchObject({
      kind: 'passed',
      partial: true,
      sourceCount: 3,
      readCount: 0,
    })
  })
})
