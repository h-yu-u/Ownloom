import { describe, expect, it } from 'vitest'
import { conversationTitle, visibleConversations } from './conversation-list'

describe('conversation list', () => {
  it('places pinned items before recent items without mutating the input or losing the limit', () => {
    const items = [
      { id: 'new', title: '新对话' },
      { id: 'old', title: 'Older', pinned: true },
      { id: 'older', title: 'Oldest', pinned: true },
    ]
    expect(visibleConversations(items, '', 2).map((item) => item.id)).toEqual(['old', 'older'])
    expect(items[0]?.id).toBe('new')
    expect(visibleConversations(items, ' old ').map((item) => item.id)).toEqual(['old', 'older'])
    expect(
      visibleConversations(
        [
          { ...items[0]!, pinned: false },
          { ...items[1]!, pinned: false },
        ],
        '',
      ).map((item) => item.id),
    ).toEqual(['new', 'old'])
  })
  it('trims names and rejects blank or oversized names', () => {
    expect(conversationTitle('  研究计划  ')).toBe('研究计划')
    expect(() => conversationTitle('   ')).toThrow()
    expect(() => conversationTitle('字'.repeat(161))).toThrow()
    expect(conversationTitle('😀'.repeat(160))).toHaveLength(320)
  })
})
