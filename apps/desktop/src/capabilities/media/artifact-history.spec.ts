import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArtifactHistory } from './artifact-history'
function deferred<T>() {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve,
  }
}
function fixture() {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:media'), revokeObjectURL: vi.fn() })
  const gateway = {
    history: vi.fn(async (offset: number) => (offset >= 0 ? ([] as { id: string }[]) : [])),
    artifact: vi.fn(async (id: string) => ({ id })),
    content: vi.fn(async () => new Blob()),
    export: vi.fn(async () => ({ kind: 'cancelled' as const })),
  }
  return { gateway, state: createArtifactHistory(gateway) }
}
afterEach(vi.unstubAllGlobals)
describe('independent artifact detail and pagination', () => {
  it('loads an old deep link despite list failure and a missing media file', async () => {
    const { state, gateway } = fixture()
    gateway.history.mockRejectedValueOnce(new Error('list unavailable'))
    gateway.content.mockRejectedValueOnce(new Error('file missing'))
    await Promise.all([state.select('older-than-page-24'), state.loadHistory()])
    await Promise.resolve()
    expect(state.selectedArtifact.value).toEqual({ id: 'older-than-page-24' })
    expect(state.historyError.value).toBe('list unavailable')
    await vi.waitFor(() =>
      expect(state.mediaErrors.value['older-than-page-24']).toBe('file missing'),
    )
    state.dispose()
  })
  it('does not let an old detail or list refresh replace the current selection', async () => {
    const { state, gateway } = fixture(),
      old = deferred<{ id: string }>()
    gateway.artifact.mockReturnValueOnce(old.promise)
    const opening = state.select('A')
    await state.select('B')
    old.resolve({ id: 'A' })
    await opening
    gateway.history.mockResolvedValueOnce([{ id: 'C' }])
    await state.loadHistory()
    expect(state.selectedArtifact.value?.id).toBe('B')
    state.dispose()
  })
  it('uses the raw page size for offsets while deduplicating and preserves items on paging failure', async () => {
    const { state, gateway } = fixture()
    gateway.history.mockResolvedValueOnce(Array.from({ length: 24 }, () => ({ id: 'same' })))
    await state.loadHistory()
    expect(state.artifacts.value).toHaveLength(1)
    gateway.history.mockRejectedValueOnce(new Error('paging failed'))
    await state.loadHistory(false)
    expect(gateway.history.mock.calls.at(-1)?.[0]).toBe(24)
    expect(state.artifacts.value).toEqual([{ id: 'same' }])
    expect(state.phase.value).toBe('more-error')
    state.dispose()
  })
  it('invalidates a slow page when refreshing, and a deleted A cannot disturb B or reappear', async () => {
    const { state, gateway } = fixture(),
      old = deferred<{ id: string }[]>()
    gateway.history.mockReturnValueOnce(old.promise)
    const fetching = state.loadHistory(false)
    gateway.history.mockResolvedValueOnce([{ id: 'B' }])
    await state.loadHistory()
    old.resolve([{ id: 'A' }])
    await fetching
    await state.select('B')
    state.forget('A')
    gateway.history.mockResolvedValueOnce([{ id: 'A' }, { id: 'B' }])
    await state.loadHistory()
    expect(state.selectedArtifact.value?.id).toBe('B')
    expect(state.artifacts.value).toEqual([{ id: 'B' }])
    state.dispose()
  })
})
