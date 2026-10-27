import type { components } from './generated-schema'
import type { Transport } from './transport/ports'
import { list, record, text, number, malformed } from './decoders'

export type AttachmentMetadata = components['schemas']['AttachmentMetadata']
export type TextPreview = components['schemas']['TextPreview']
export type Processing = components['schemas']['ProcessingView']
export type DraftSelection = components['schemas']['DraftSelection']

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw malformed()
  return value
}
export function decodeCoverage(value: unknown): components['schemas']['CoverageView'] {
  const item = record(value)
  return {
    complete: boolean(item.complete),
    readablePages: list(item.readablePages ?? [], number),
    unreadablePages: list(item.unreadablePages ?? [], number),
    frame: item.frame == null ? null : number(item.frame),
    selectedBlocks: item.selectedBlocks == null ? null : number(item.selectedBlocks),
    totalBlocks: item.totalBlocks == null ? null : number(item.totalBlocks),
  }
}
export function decodeAttachment(value: unknown): AttachmentMetadata {
  const item = record(value)
  const kind = text(item.kind)
  const format = text(item.format)
  if (kind !== 'image' && kind !== 'document') throw malformed()
  if (!isFormat(format)) throw malformed()
  let processing: Processing | null = null
  if (item.processing != null) {
    const result = record(item.processing)
    const state = text(result.state)
    if (!isState(state)) throw malformed()
    processing = {
      preparationId: text(result.preparationId),
      revision: number(result.revision),
      state,
      pageCount: result.pageCount == null ? null : number(result.pageCount),
      coverage: decodeCoverage(result.coverage),
      warnings: list(result.warnings, text),
      errorCode: result.errorCode == null ? null : text(result.errorCode),
      retryable: boolean(result.retryable),
    }
  }
  return {
    id: text(item.id),
    kind,
    format,
    mimeType: text(item.mimeType),
    originalName: text(item.originalName),
    sizeBytes: number(item.sizeBytes),
    sha256: text(item.sha256),
    processing,
  }
}
function isFormat(value: string): value is AttachmentMetadata['format'] {
  return ['png', 'jpeg', 'webp', 'gif', 'txt', 'md', 'docx', 'pdf'].includes(value)
}
function isState(value: string): value is Processing['state'] {
  return ['queued', 'preparing', 'ready', 'partial', 'needs_ocr', 'failed', 'cancelled'].includes(
    value,
  )
}
export function decodeTextPreview(value: unknown): TextPreview {
  const item = record(value)
  return {
    preparationId: text(item.preparationId),
    totalBlocks: number(item.totalBlocks),
    coverage: decodeCoverage(item.coverage),
    warnings: list(item.warnings, text),
    blocks: list(item.blocks, (value) => {
      const block = record(value)
      return {
        id: text(block.id),
        text: text(block.text),
        page: block.page == null ? null : number(block.page),
        section: block.section == null ? null : text(block.section),
      }
    }),
  }
}
export function attachmentEndpoints(transport: Transport) {
  const path = (id: string) => `/internal/v1/attachments/${encodeURIComponent(id)}`
  return {
    metadata: async (id: string, signal?: AbortSignal) =>
      decodeAttachment(await transport.get(`${path(id)}/metadata`, signal)),
    retry: async (id: string) => decodeAttachment(await transport.post(`${path(id)}/retry`)),
    text: async (id: string, preparation: string, start = 0, signal?: AbortSignal) =>
      decodeTextPreview(
        await transport.get(
          `${path(id)}/preview?view=text&preparation_id=${encodeURIComponent(preparation)}&block_start=${start}`,
          signal,
        ),
      ),
    lease: (id: string, body: DraftSelection) =>
      transport.put(`/internal/v1/attachment-drafts/${encodeURIComponent(id)}`, body),
    close: (id: string) =>
      transport.delete(`/internal/v1/attachment-drafts/${encodeURIComponent(id)}`),
  }
}
