import { ref, type Ref } from 'vue'
import type { CodingChange, CodingChanges, CodingGateway } from '../application/ports'
import type { InspectorPanel } from '../domain/inspector'
import { latestChanges } from '../domain/inspector'
import { codingErrorText } from './coding-errors'

export function createCodingInspector(input: {
  gateway: Pick<CodingGateway, 'files' | 'read' | 'changes' | 'change' | 'restore'>
  sessionId: Readonly<Ref<string>>
  busy: Readonly<Ref<boolean>>
  onRestored(): Promise<unknown>
}) {
  const panel = ref<InspectorPanel | null>(null)
  const changes = ref<CodingChanges | null>(null)
  const selectedChange = ref<CodingChange | null>(null)
  const fileList = ref<string[]>([])
  const fileContent = ref<string | null>(null)
  const filePath = ref('')
  const changesHasMore = ref(false)
  const inspectorPending = ref(false)
  const inspectorError = ref<string | null>(null)
  let lastPanel: InspectorPanel = 'changes'
  let epoch = 0,
    dirty = false

  function resetInspector(): void {
    epoch++
    dirty = false
    panel.value = null
    changes.value = null
    changesHasMore.value = false
    selectedChange.value = null
    fileList.value = []
    fileContent.value = null
    filePath.value = ''
    inspectorPending.value = false
    inspectorError.value = null
  }
  async function load(action: (current: () => boolean) => Promise<void>): Promise<void> {
    const owner = ++epoch,
      session = input.sessionId.value
    inspectorPending.value = true
    inspectorError.value = null
    const current = () => owner === epoch && session === input.sessionId.value && !!panel.value
    try {
      await action(current)
    } catch (error) {
      if (current()) inspectorError.value = codingErrorText(error)
    } finally {
      if (current()) {
        inspectorPending.value = false
        if (dirty) {
          dirty = false
          void refreshInspector()
        }
      }
    }
  }
  async function changeContent(id: string): Promise<CodingChange> {
    const item = changes.value?.managed.find((change) => change.id === id)
    const first = changes.value?.managed.find(
      (change) => change.path === item?.path && !change.restored,
    )
    const [before, after] = await Promise.all([
      input.gateway.change(first?.id ?? id),
      first?.id === id ? Promise.resolve(null) : input.gateway.change(id),
    ])
    return { ...(after ?? before), before: before.before }
  }
  async function loadChange(id: string): Promise<void> {
    selectedChange.value = null
    await load(async (current) => {
      const item = await changeContent(id)
      if (current()) selectedChange.value = item
    })
  }
  async function readFile(path: string): Promise<void> {
    filePath.value = path
    fileContent.value = null
    await load(async (current) => {
      const content = await input.gateway.read(input.sessionId.value, path)
      if (current()) fileContent.value = content
    })
  }
  async function refreshInspector(): Promise<void> {
    if (!panel.value) return
    if (inspectorPending.value) {
      dirty = true
      return
    }
    await load(async (current) => {
      if (panel.value === 'files') {
        const paths = await input.gateway.files(input.sessionId.value)
        if (!current()) return
        fileList.value = paths
        const path = filePath.value
        if (path && paths.includes(path)) {
          const content = await input.gateway.read(input.sessionId.value, path)
          if (current()) fileContent.value = content
        } else if (path) {
          filePath.value = ''
          fileContent.value = null
        }
      } else {
        const result = await input.gateway.changes(input.sessionId.value)
        if (!current()) return
        const path = selectedChange.value?.path
        changes.value = result
        changesHasMore.value = result.managed.length === 100
        const item =
          latestChanges(result.managed).find((change) => change.path === path) ??
          latestChanges(result.managed)[0]
        const content = item ? await changeContent(item.id) : null
        if (current()) selectedChange.value = content
      }
    })
  }
  async function loadMoreChanges(): Promise<void> {
    if (!changesHasMore.value || inspectorPending.value || !changes.value) return
    const previous = changes.value
    await load(async (current) => {
      const result = await input.gateway.changes(input.sessionId.value, previous.managed[0]?.id)
      if (!current()) return
      const known = new Set(previous.managed.map((item) => item.id))
      changes.value = {
        ...previous,
        managed: [...result.managed.filter((item) => !known.has(item.id)), ...previous.managed],
      }
      changesHasMore.value = result.managed.length === 100
    })
  }
  async function inspect(value: InspectorPanel): Promise<void> {
    if (panel.value === value) {
      resetInspector()
      return
    }
    resetInspector()
    lastPanel = value
    panel.value = value
    await refreshInspector()
  }
  async function toggleInspector(): Promise<void> {
    if (panel.value) resetInspector()
    else if (input.sessionId.value) await inspect(lastPanel)
  }
  async function previewFile(path: string): Promise<void> {
    const session = input.sessionId.value
    if (panel.value !== 'files') await inspect('files')
    if (input.sessionId.value !== session || panel.value !== 'files') return
    await readFile(path)
  }
  async function restore(id: string): Promise<void> {
    if (input.busy.value || inspectorPending.value) return
    await load(async (current) => {
      await input.gateway.restore(id)
      await input.onRestored()
      const result = await input.gateway.changes(input.sessionId.value)
      if (current()) {
        changes.value = result
        changesHasMore.value = result.managed.length === 100
        selectedChange.value = null
      }
    })
  }
  return {
    panel,
    changes,
    changesHasMore,
    loadMoreChanges,
    selectedChange,
    fileList,
    fileContent,
    filePath,
    inspectorPending,
    inspectorError,
    inspect,
    toggleInspector,
    readFile,
    previewFile,
    loadChange,
    restore,
    refreshInspector,
    resetInspector,
  }
}
