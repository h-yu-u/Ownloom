import { reactive } from 'vue'
import { MediaCache } from '../../../capabilities/media'
import type { TextPreview } from '@mlx-studio/api-client'
import type { AttachmentGateway } from '../application/attachment-ports'

export interface PreviewTarget {
  id: string
  preparationId: string
  kind: 'image' | 'document'
  originalName: string
}
export function createAttachmentPreviewController(gateway: AttachmentGateway) {
  const state = reactive({
    target: null as PreviewTarget | null,
    loading: false,
    error: '',
    url: '',
    text: null as TextPreview | null,
    scope: 'draft' as 'draft' | 'history',
  })
  let epoch = 0
  const cache = () =>
    new MediaCache(
      (id, signal) => gateway.original(id, signal),
      () => undefined,
      8,
    )
  const caches = { draft: cache(), history: cache() }
  let request: AbortController | undefined
  async function open(target: PreviewTarget, scope: 'draft' | 'history' = 'draft'): Promise<void> {
    close()
    const owner = epoch
    state.target = target
    state.scope = scope
    state.loading = true
    request = new AbortController()
    try {
      if (target.kind === 'image') {
        const url = await caches[scope].get(target.id)
        if (owner === epoch) state.url = url ?? ''
      } else {
        const value = await gateway.text(target.id, target.preparationId, 0, request.signal)
        if (owner === epoch) state.text = value
      }
    } catch (cause) {
      if (owner === epoch) state.error = cause instanceof Error ? cause.message : '预览失败'
    } finally {
      if (owner === epoch) state.loading = false
    }
  }
  async function more(): Promise<void> {
    if (!state.target || !state.text || state.loading) return
    const owner = epoch,
      start = state.text.blocks.length,
      target = state.target
    state.loading = true
    try {
      const value = await gateway.text(target.id, target.preparationId, start, request?.signal)
      if (owner === epoch && state.text)
        state.text = { ...value, blocks: [...state.text.blocks, ...value.blocks] }
    } catch (cause) {
      if (owner === epoch) state.error = cause instanceof Error ? cause.message : '预览失败'
    } finally {
      if (owner === epoch) state.loading = false
    }
  }
  function close(): void {
    epoch++
    request?.abort()
    state.target = null
    state.url = ''
    state.text = null
    state.error = ''
    state.loading = false
  }
  function evict(id: string): void {
    caches.draft.evict(id)
    if (state.scope === 'draft' && state.target?.id === id) close()
  }
  function dispose(): void {
    close()
    caches.draft.dispose()
    caches.history.dispose()
  }
  return { state, open, more, close, evict, dispose }
}
