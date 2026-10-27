import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { createDraftRestorer, type RestoredDraft } from './draft-restorer'
function deferred<T>() {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve,
  }
}
describe('restoring asynchronously into an editable draft', () => {
  it('keeps a candidate after editing, and an old restore cannot override a newer restore', async () => {
    const form = ref({ text: 'original' }),
      state = createDraftRestorer(form),
      first = deferred<RestoredDraft<{ text: string }>>()
    const restoring = state.restore(() => first.promise)
    form.value.text = 'typed while loading'
    first.resolve({ draft: { text: 'history A' }, adjustments: [], canSubmit: true })
    await restoring
    expect(form.value.text).toBe('typed while loading')
    expect(state.candidate.value?.draft.text).toBe('history A')
    state.applyCandidate()
    expect(form.value.text).toBe('history A')
    const old = deferred<RestoredDraft<{ text: string }>>(),
      loading = state.restore(() => old.promise)
    await state.restore(async () => ({
      draft: { text: 'history B' },
      adjustments: [],
      canSubmit: true,
    }))
    old.resolve({ draft: { text: 'stale A' }, adjustments: [], canSubmit: true })
    await loading
    expect(form.value.text).toBe('history B')
    state.dispose()
  })
})
