import { describe, expect, it } from 'vitest'
import { formatConversation } from './export-conversation'
import type { ChatMessage } from './chat-state'
import type { MessageSource } from './message-source'

const fileSource: Extract<MessageSource, { kind: 'file' }> = {
  id: 'v1',
  kind: 'file',
  attachmentId: 'attachment',
  preparationId: 'preparation',
  originalName: '照片.png',
  representation: 'image',
}

function exportSource(source: MessageSource): string {
  return formatConversation('资料问答', [
    { id: 'answer', role: 'assistant', content: '回答', sources: [source] },
  ])
}

describe('conversation export', () => {
  it.each([{ locations: undefined }, { locations: [] }])(
    'omits location brackets when file locations are $locations',
    ({ locations }) => {
      expect(exportSource({ ...fileSource, locations })).toBe(
        '# 资料问答\n\n## Ownloom\n\n回答\n\n参考来源\n[v1] 照片.png',
      )
    },
  )

  it('preserves document page, section and block locations in order', () => {
    expect(
      exportSource({
        ...fileSource,
        originalName: '资料.pdf',
        representation: 'text',
        locations: [
          { blockId: 'page-block', page: 2, section: 'ignored' },
          { blockId: 'section-block', page: null, section: '总结' },
          { blockId: 'paragraph-3', page: null, section: null },
        ],
      }),
    ).toContain('[v1] 资料.pdf（第 2 页、总结、paragraph-3）')
  })

  it.each(['snippet_only', 'page_excerpt'] as const)(
    'keeps web metadata and the %s representation label',
    (representation) => {
      expect(
        exportSource({
          id: 'w1',
          kind: 'web',
          title: '文档',
          url: 'https://example.com/docs',
          retrievedAt: '2026-11-07T12:00:00Z',
          contentHash: 'hash',
          representation,
        }),
      ).toContain(
        `[w1] 文档 — https://example.com/docs（检索于 2026-11-07T12:00:00Z；${representation === 'snippet_only' ? '仅摘要' : '网页摘录'}）`,
      )
    },
  )

  it('keeps title, message order, roles, body and attachment names without changing input', () => {
    const messages: ChatMessage[] = [
      {
        id: 'question',
        role: 'user',
        content: '请总结',
        attachments: [{ id: 'attachment', originalName: '资料.pdf', mimeType: 'application/pdf' }],
      },
      { id: 'answer', role: 'assistant', content: '总结正文' },
    ]
    const original = structuredClone(messages)
    expect(formatConversation('对话', messages)).toBe(
      '# 对话\n\n## 你\n\n请总结\n\n附件：资料.pdf\n\n## Ownloom\n\n总结正文',
    )
    expect(messages).toEqual(original)
    expect(formatConversation('空对话', [])).toBe('# 空对话')
  })
})
