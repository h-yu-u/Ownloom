import type { components } from './generated-schema'
import { decodeCoverage } from './attachments'
import { record, text, list, number, nullableText, malformed } from './decoders'

export type MessageSource = components['schemas']['FileSource'] | components['schemas']['WebSource']
export function decodeSource(value: unknown): MessageSource {
  const item = record(value)
  if (item.kind === 'file') {
    const representation = text(item.representation)
    if (representation !== 'text' && representation !== 'image') throw malformed()
    return {
      id: text(item.id),
      kind: 'file',
      attachmentId: text(item.attachmentId),
      preparationId: text(item.preparationId),
      originalName: text(item.originalName),
      representation,
      coverage: decodeCoverage(item.coverage),
      locations: list(item.locations ?? [], (value) => {
        const location = record(value)
        return {
          blockId: text(location.blockId),
          page: location.page == null ? null : number(location.page),
          section: nullableText(location.section),
          contentHash: nullableText(location.contentHash),
        }
      }),
    }
  }
  if (item.kind === 'web') {
    const representation = text(item.representation)
    if (representation !== 'page_excerpt' && representation !== 'snippet_only') throw malformed()
    const url = text(item.url)
    if (!/^https?:\/\//i.test(url)) throw malformed()
    return {
      id: text(item.id),
      kind: 'web',
      title: text(item.title),
      url,
      retrievedAt: text(item.retrievedAt),
      publishedAt: nullableText(item.publishedAt),
      representation,
      contentHash: text(item.contentHash),
    }
  }
  throw malformed()
}
