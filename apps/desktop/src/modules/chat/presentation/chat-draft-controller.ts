import { computed, ref, type Ref } from 'vue'
import type { Conversation } from '@mlx-studio/api-client'
import { ChatDrafts } from '../application/chat-drafts'
import { ManageAttachments } from '../application/manage-attachments'
import type { AttachmentGateway } from '../application/attachment-ports'
import { createAttachmentPreviewController } from './attachment-preview-controller'
import { MediaCache } from '../../../capabilities/media'

export function createChatDraftController(
  conversationId: Ref<string | null>,
  gateway: AttachmentGateway,
  updatePreference: (id: string, enabled: boolean) => Promise<unknown>,
) {
  const revision = ref(0),
    error = ref(''),
    thumbnails = ref<Record<string, string>>({})
  let freshKey = `new:${crypto.randomUUID()}`
  const book = new ChatDrafts(() => {
    revision.value++
  })
  const manager = new ManageAttachments(book, gateway, (message) => {
    error.value = message
  })
  const key = computed(() =>
    conversationId.value ? `conversation:${conversationId.value}` : freshKey,
  )
  const draft = computed(() => {
    void revision.value
    return book.get(key.value)
  })
  const preview = createAttachmentPreviewController(gateway)
  const thumbnailCache = new MediaCache(
    (key, signal) => {
      const [id, preparation] = key.split(':')
      return gateway.thumbnail(id!, preparation!, signal)
    },
    () => {
      thumbnails.value = thumbnailCache.snapshot()
    },
    16,
  )
  const preferences = new Set<string>()
  function restore(item: Conversation): void {
    const target = `conversation:${item.id}`
    if (!preferences.has(target)) {
      book.edit(target, { webSearchEnabled: item.webSearchEnabled === true })
      preferences.add(target)
    }
  }
  function bind(conversation: string): void {
    book.bind(key.value, conversation)
    preferences.add(`conversation:${conversation}`)
    freshKey = `new:${crypto.randomUUID()}`
  }
  async function setWeb(enabled: boolean): Promise<void> {
    const target = key.value,
      old = book.get(target).webSearchEnabled
    book.edit(target, { webSearchEnabled: enabled })
    if (conversationId.value) {
      try {
        await updatePreference(conversationId.value, enabled)
      } catch (cause) {
        book.edit(target, { webSearchEnabled: old })
        throw cause
      }
    }
  }
  function remove(id: string): void {
    const item = draft.value.attachments.find((item) => item.clientId === id)
    if (item?.attachmentId) {
      preview.evict(item.attachmentId)
      if (item.preparationId) thumbnailCache.evict(`${item.attachmentId}:${item.preparationId}`)
    }
    manager.remove(key.value, id)
  }
  function discard(conversation: string): void {
    const target = `conversation:${conversation}`
    for (const item of book.get(target).attachments) {
      if (item.attachmentId && item.preparationId)
        thumbnailCache.evict(`${item.attachmentId}:${item.preparationId}`)
    }
    if (conversationId.value === conversation) preview.close()
    manager.close(target)
  }
  async function open(id: string): Promise<void> {
    const item = draft.value.attachments.find((item) => item.clientId === id)
    if (item?.attachmentId && item.preparationId)
      await preview.open({
        id: item.attachmentId,
        preparationId: item.preparationId,
        kind: item.kind,
        originalName: item.originalName,
      })
  }
  async function loadThumbnails(): Promise<void> {
    const items = draft.value.attachments.filter(
      (item) =>
        item.kind === 'image' &&
        item.attachmentId &&
        item.preparationId &&
        ['ready', 'partial'].includes(item.processing),
    )
    await Promise.allSettled(
      items.map((item) => thumbnailCache.get(`${item.attachmentId}:${item.preparationId}`)),
    )
  }
  const thumbnailUrls = computed(() =>
    Object.fromEntries(
      draft.value.attachments.map((item) => [
        item.clientId,
        thumbnails.value[`${item.attachmentId}:${item.preparationId}`] ?? '',
      ]),
    ),
  )
  return {
    draft,
    error,
    preview,
    thumbnailUrls,
    loadThumbnails,
    restore,
    bind,
    discard,
    setWeb,
    setText: (text: string) => book.edit(key.value, { text }),
    ignoreVisuals: () => book.edit(key.value, { visualSelection: { mode: 'none' } }),
    add: (files: File[]) => manager.add(key.value, files),
    remove,
    retry: (id: string) => manager.retry(key.value, id),
    open,
    consume: (key: string, revision: number) => manager.consumed(key, revision),
    disposePreview: () => {
      preview.dispose()
      thumbnailCache.dispose()
    },
  }
}
