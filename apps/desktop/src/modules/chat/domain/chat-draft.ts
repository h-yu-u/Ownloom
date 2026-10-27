export type AttachmentFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'txt' | 'md' | 'docx' | 'pdf'
export interface DraftAttachment {
  readonly clientId: string
  readonly uploadKey: string
  readonly originalName: string
  readonly sizeBytes: number
  readonly kind: 'image' | 'document'
  readonly format: AttachmentFormat
  readonly transfer: 'local' | 'uploading' | 'stored' | 'failed'
  readonly attachmentId?: string
  readonly processing:
    | 'waiting'
    | 'queued'
    | 'preparing'
    | 'ready'
    | 'partial'
    | 'needs_ocr'
    | 'failed'
    | 'cancelled'
  readonly preparationId?: string
  readonly processingRevision: number
  readonly pageCount?: number
  readonly warnings: readonly string[]
  readonly error?: string
  readonly retryable: boolean
}
export type VisualSelection =
  | { mode: 'auto' | 'none' }
  | { mode: 'explicit'; attachmentIds: readonly string[] }
export interface ChatDraft {
  readonly key: string
  readonly id: string
  readonly revision: number
  readonly selectionRevision: number
  readonly text: string
  readonly attachments: readonly DraftAttachment[]
  readonly webSearchEnabled: boolean
  readonly visualSelection: VisualSelection
}
export function newDraft(key: string, id: string): ChatDraft {
  return {
    key,
    id,
    revision: 0,
    selectionRevision: 0,
    text: '',
    attachments: [],
    webSearchEnabled: false,
    visualSelection: { mode: 'auto' },
  }
}
export function patchDraft(
  draft: ChatDraft,
  patch: Partial<Pick<ChatDraft, 'text' | 'attachments' | 'webSearchEnabled' | 'visualSelection'>>,
  selection = false,
): ChatDraft {
  return {
    ...draft,
    ...patch,
    revision: draft.revision + 1,
    selectionRevision: draft.selectionRevision + Number(selection),
  }
}
export function consumeDraft(draft: ChatDraft, revision: number): ChatDraft {
  return draft.revision === revision
    ? patchDraft(draft, { text: '', attachments: [], visualSelection: { mode: 'auto' } }, true)
    : draft
}
