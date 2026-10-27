import { ref, shallowRef, watch, type Ref } from 'vue'
import type { RestoreNotice } from './restore-notice'
export interface RestoredDraft<T> {
  draft: T
  adjustments: readonly RestoreNotice[]
  canSubmit: boolean
}
export function createDraftRestorer<T>(form: Ref<T>) {
  const pending = ref(false),
    candidate = shallowRef<RestoredDraft<T> | null>(null),
    adjustments = shallowRef<readonly RestoreNotice[]>([])
  let revision = 0,
    action = 0,
    alive = true
  watch(
    form,
    () => {
      revision++
    },
    { deep: true, flush: 'sync' },
  )
  function apply(result: RestoredDraft<T>): void {
    form.value = result.draft
    adjustments.value = result.adjustments
    candidate.value = null
  }
  async function restore(prepare: () => Promise<RestoredDraft<T>>): Promise<void> {
    const owner = ++action,
      captured = revision
    pending.value = true
    candidate.value = null
    try {
      const result = await prepare()
      if (owner !== action || !alive) return
      if (captured === revision) apply(result)
      else candidate.value = result
    } finally {
      if (owner === action) pending.value = false
    }
  }
  return {
    pending,
    candidate,
    adjustments,
    restore,
    applyCandidate: () => {
      if (candidate.value) apply(candidate.value)
    },
    activate: () => {
      alive = true
    },
    dispose: () => {
      alive = false
      action++
      pending.value = false
    },
  }
}
