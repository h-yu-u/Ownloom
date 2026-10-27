import { computed, ref, type Ref } from 'vue'
import type { CodingGateway, CodingRun } from '../application/ports'
import type { CodingPermissionMode } from '../domain/status'

export function createCodingPermissions(deps: {
  gateway: CodingGateway
  sessionId: Ref<string>
  active: Readonly<Ref<CodingRun | null>>
  pending: Ref<boolean>
  guard<T>(action: () => Promise<T>): Promise<T | undefined>
  refresh(): Promise<number>
}) {
  const choices = ref<Record<string, CodingPermissionMode>>({})
  const mode = computed(() =>
    deps.active.value?.sessionId === deps.sessionId.value
      ? (deps.active.value.permissionMode ?? 'ask')
      : (choices.value[deps.sessionId.value] ?? 'ask'),
  )
  async function change(permissionMode: CodingPermissionMode): Promise<void> {
    if (deps.pending.value || !deps.sessionId.value) return
    const sessionId = deps.sessionId.value
    const active = deps.active.value
    if (active?.sessionId === sessionId) {
      await deps.guard(async () => {
        await deps.gateway.setPermissions(active.id, permissionMode)
        choices.value = { ...choices.value, [sessionId]: permissionMode }
        await deps.refresh()
      })
    } else choices.value = { ...choices.value, [sessionId]: permissionMode }
  }
  return { mode, change }
}
