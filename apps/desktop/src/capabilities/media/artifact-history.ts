import { ref, shallowRef } from 'vue'
import { RequestScope } from '../requests'
import { MediaCache } from './media-cache'
import { createExportOperation } from '../../shared/lib/export-operation'
import type { FileExportResult } from '../../shared/lib/file-export'
import type { ListPhase } from '../../shared/ui/resource-list.types'
/** Metadata, pagination and media have independent ownership and failure states. */
export function createArtifactHistory<T extends { id: string }>(deps: {
  history(offset: number, signal?: AbortSignal): Promise<T[]>
  artifact(id: string, signal?: AbortSignal): Promise<T>
  content(id: string, signal?: AbortSignal): Promise<Blob>
  thumbnail?(id: string, signal?: AbortSignal): Promise<Blob>
  export(blob: Blob, id: string): Promise<FileExportResult>
}) {
  const artifacts = shallowRef<T[]>([]),
    selectedId = ref<string | null>(null),
    selectedArtifact = shallowRef<T | null>(null)
  const urls = ref<Record<string, string>>({}),
    mediaErrors = ref<Record<string, string>>({})
  const historyLoading = ref(false),
    hasMore = ref(false),
    historyError = ref<string | null>(null)
  const detailError = ref<string | null>(null),
    detailLoading = ref(false)
  const listScope = new RequestScope(),
    detailScope = new RequestScope(),
    exports = createExportOperation()
  const phase = ref<ListPhase>('initial-loading')
  let active = true,
    nextOffset = 0,
    selectionRevision = 0
  const deleting = new Set<string>()
  const changed = () => {
    urls.value = { ...media.snapshot(), ...originals.snapshot() }
  }
  const media = new MediaCache(deps.thumbnail ?? deps.content, changed)
  const originals = new MediaCache(deps.content, changed, 2)
  const visible = new Map<string, () => void>()
  let releaseSelected: (() => void) | undefined
  function message(cause: unknown): string {
    return cause instanceof Error ? cause.message : '读取作品失败'
  }
  async function loadMedia(id: string): Promise<void> {
    const owner = detailScope.owner
    try {
      await media.get(id)
      if (active && detailScope.owns(owner)) delete mediaErrors.value[id]
    } catch (cause) {
      if (active && detailScope.owns(owner)) mediaErrors.value[id] = message(cause)
    }
  }
  async function select(id: string, manual = true): Promise<void> {
    releaseSelected?.()
    releaseSelected = originals.retain(id)
    if (manual) selectionRevision++
    detailScope.reset()
    const owner = detailScope.owner
    selectedId.value = id
    selectedArtifact.value = null
    detailError.value = null
    detailLoading.value = true
    try {
      const item = await deps.artifact(id, detailScope.signal)
      if (!active || !detailScope.owns(owner)) return
      selectedArtifact.value = item
      void originals.get(id).catch((cause: unknown) => {
        if (active && detailScope.owns(owner)) mediaErrors.value[id] = message(cause)
      })
    } catch (cause) {
      if (active && detailScope.owns(owner)) detailError.value = message(cause)
    } finally {
      if (detailScope.owns(owner)) detailLoading.value = false
    }
  }
  async function loadHistory(reset = true): Promise<void> {
    if (!active || (!reset && historyLoading.value)) return
    if (reset) listScope.reset()
    const owner = listScope.owner,
      offset = reset ? 0 : nextOffset
    historyLoading.value = true
    historyError.value = null
    phase.value = artifacts.value.length
      ? reset
        ? 'refreshing'
        : 'loading-more'
      : 'initial-loading'
    try {
      const page = await deps.history(offset, listScope.signal)
      if (!active || !listScope.owns(owner)) return
      const items = (reset ? page : [...artifacts.value, ...page]).filter(
        (item) => !deleting.has(item.id),
      )
      artifacts.value = [...new Map(items.map((item) => [item.id, item])).values()]
      nextOffset = offset + page.length
      hasMore.value = page.length === 24
      phase.value = artifacts.value.length ? 'ready' : 'empty'
      if (!selectedId.value && !selectionRevision && artifacts.value[0])
        await select(artifacts.value[0].id, false)
    } catch (cause) {
      if (listScope.owns(owner)) {
        historyError.value = message(cause)
        phase.value = artifacts.value.length ? 'more-error' : 'initial-error'
      }
    } finally {
      if (listScope.owns(owner)) historyLoading.value = false
    }
  }
  async function save(id: string) {
    return exports.run({ id, read: () => deps.content(id), write: (blob) => deps.export(blob, id) })
  }
  function forget(id: string): void {
    deleting.add(id)
    artifacts.value = artifacts.value.filter((item) => item.id !== id)
    media.evict(id)
    originals.evict(id)
    if (selectedId.value === id) {
      detailScope.reset()
      selectedId.value = null
      selectedArtifact.value = null
      detailError.value = null
      selectionRevision++
    }
  }
  function dispose(): void {
    active = false
    listScope.dispose()
    detailScope.dispose()
    exports.invalidate()
    releaseSelected?.()
    for (const release of visible.values()) release()
    visible.clear()
    originals.dispose()
    media.dispose()
    historyLoading.value = false
  }
  function activate(): void {
    active = true
    listScope.reset()
    detailScope.reset()
    if (selectedId.value) void select(selectedId.value, false)
  }
  return {
    artifacts,
    selectedId,
    selectedArtifact,
    urls,
    mediaErrors,
    historyLoading,
    hasMore,
    historyError,
    detailError,
    detailLoading,
    phase,
    savingId: exports.firstId,
    savingById: exports.pending,
    loadHistory,
    select,
    loadMedia,
    visibility(id: string, shown: boolean) {
      if (shown) {
        if (!visible.has(id)) visible.set(id, media.retain(id))
        void loadMedia(id)
      } else {
        visible.get(id)?.()
        visible.delete(id)
      }
    },
    save,
    forget,
    dispose,
    activate,
    getSelectionRevision: () => selectionRevision,
  }
}
