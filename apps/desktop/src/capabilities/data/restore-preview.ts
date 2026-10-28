import { ref } from 'vue'

interface RestorePreview {
  id: string
  bytes: number
  files: number
  warnings: string[]
}
export interface RestorePreviewDependencies {
  inspect(file: File): Promise<RestorePreview>
  discardPreview(id: string): Promise<unknown>
  activate(id: string): Promise<unknown>
}

/** The page owns staged uploads until activation is handed to the server. */
export function createRestorePreview(deps: RestorePreviewDependencies) {
  const preview = ref<RestorePreview | null>(null)
  let active = true,
    transferredId: string | undefined
  async function release(): Promise<void> {
    const current = preview.value
    preview.value = null
    if (!current || current.id === transferredId) return
    try {
      await deps.discardPreview(current.id)
    } catch (cause) {
      if (active) preview.value = current
      throw cause
    }
  }
  async function inspect(file: File): Promise<void> {
    await release()
    if (!active) return
    const next = await deps.inspect(file)
    if (active) preview.value = next
    else await deps.discardPreview(next.id)
  }
  async function activate(): Promise<boolean> {
    const current = preview.value
    if (!active || !current) return false
    // A lost reply cannot prove that the server did not activate the profile.
    transferredId = current.id
    await deps.activate(current.id)
    preview.value = null
    return true
  }
  function dispose(): void {
    active = false
    // Server expiry covers cleanup failures after the page can no longer report them.
    void release().catch(() => {})
  }
  return { preview, inspect, activate, cancel: release, dispose }
}
