import { onScopeDispose, ref } from 'vue'
export interface CodeCopyIntent {
  contentId: string
  blockKey: string
  requestId: string
  text: string
}
export interface CodeCopyState {
  contentId: string
  blockKey: string
  requestId: string
  phase: 'pending' | 'copied' | 'failed'
}
export function useMarkdownCopy(write: (text: string) => Promise<void>) {
  const copyState = ref<CodeCopyState>()
  let alive = true,
    timer: ReturnType<typeof setTimeout> | undefined
  onScopeDispose(() => {
    alive = false
    clearTimeout(timer)
  })
  async function copyCode(intent: CodeCopyIntent): Promise<void> {
    clearTimeout(timer)
    copyState.value = { ...intent, phase: 'pending' }
    let phase: 'copied' | 'failed'
    try {
      await write(intent.text)
      phase = 'copied'
    } catch {
      phase = 'failed'
    }
    if (!alive || copyState.value?.requestId !== intent.requestId) return
    copyState.value = { ...intent, phase }
    timer = setTimeout(() => {
      if (copyState.value?.requestId === intent.requestId) copyState.value = undefined
    }, 1800)
  }
  return { copyState, copyCode }
}
