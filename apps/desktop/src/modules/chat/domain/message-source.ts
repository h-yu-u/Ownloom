export interface SourceLocation {
  blockId: string
  page?: number | null
  section?: string | null
  contentHash?: string | null
}
export interface SourceCoverage {
  complete?: boolean
  readablePages?: number[]
  unreadablePages?: number[]
  selectedBlocks?: number | null
  totalBlocks?: number | null
}
export type MessageSource =
  | {
      id: string
      kind: 'file'
      attachmentId: string
      preparationId: string
      originalName: string
      representation: 'text' | 'image'
      locations?: SourceLocation[]
      coverage?: SourceCoverage
    }
  | {
      id: string
      kind: 'web'
      title: string
      url: string
      retrievedAt: string
      publishedAt?: string | null
      representation: 'page_excerpt' | 'snippet_only'
      contentHash: string
    }
