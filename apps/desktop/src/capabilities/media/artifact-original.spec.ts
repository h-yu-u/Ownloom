import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArtifactHistory } from './artifact-history'

function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => (resolve = done)), resolve }
}
function fixture() {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:original'), revokeObjectURL: vi.fn() })
  const content = vi.fn(async () => new Blob()),
    thumbnail = vi.fn(async () => new Blob())
  const state = createArtifactHistory({
    content,
    thumbnail,
    artifact: async (id: string) => ({ id }),
    history: async () => [],
    export: async () => ({ kind: 'cancelled' as const }),
  })
  return { state, content, thumbnail }
}
afterEach(vi.unstubAllGlobals)
describe('original media retries', () => {
  it('keeps failure visible and shares repeated requests without loading thumbnails', async () => {
    const { state, content, thumbnail } = fixture()
    content.mockRejectedValueOnce(new Error('still unavailable'))
    await state.loadOriginal('A')
    expect(state.mediaErrors.value.A).toBe('still unavailable')
    const result = deferred<Blob>()
    content.mockReturnValueOnce(result.promise)
    const first = state.loadOriginal('A'),
      second = state.loadOriginal('A')
    expect(state.mediaErrors.value.A).toBe('still unavailable')
    expect(content).toHaveBeenCalledTimes(2)
    result.resolve(new Blob())
    await Promise.all([first, second])
    expect(state.mediaErrors.value.A).toBeUndefined()
    expect(state.urls.value.A).toBe('blob:original')
    expect(thumbnail).not.toHaveBeenCalled()
    state.dispose()
  })
  it('keeps gallery loading on the thumbnail path', async () => {
    const { state, content, thumbnail } = fixture()
    await state.loadMedia('A')
    expect(thumbnail).toHaveBeenCalledOnce()
    expect(content).not.toHaveBeenCalled()
    state.dispose()
  })
  it('does not let an obsolete original retry clear an error after a new selection', async () => {
    const { state, content } = fixture(),
      result = deferred<Blob>()
    state.mediaErrors.value.A = 'old failure'
    content.mockReturnValueOnce(result.promise)
    const retry = state.loadOriginal('A')
    await state.select('B')
    result.resolve(new Blob())
    await retry
    expect(state.selectedId.value).toBe('B')
    expect(state.mediaErrors.value.A).toBe('old failure')
    state.dispose()
  })
  it.each(['forget', 'dispose'] as const)(
    'does not revive an original after %s',
    async (action) => {
      const { state, content } = fixture(),
        result = deferred<Blob>()
      state.mediaErrors.value.A = 'old failure'
      content.mockReturnValueOnce(result.promise)
      const retry = state.loadOriginal('A')
      if (action === 'forget') state.forget('A')
      else state.dispose()
      result.resolve(new Blob())
      await retry
      expect(state.urls.value.A).toBeUndefined()
      expect(state.mediaErrors.value.A).toBe('old failure')
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      state.dispose()
    },
  )
})
