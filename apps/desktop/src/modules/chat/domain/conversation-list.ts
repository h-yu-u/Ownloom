interface ConversationItem {
  id: string
  title: string
  pinned?: boolean
}

export function visibleConversations<T extends ConversationItem>(
  items: readonly T[],
  query: string,
  limit?: number,
): T[] {
  const normalized = query.trim().toLowerCase()
  return items
    .filter((item) => item.title.toLowerCase().includes(normalized))
    .sort((left, right) => Number(right.pinned === true) - Number(left.pinned === true))
    .slice(0, limit)
}

export function conversationTitle(value: string): string {
  const title = value.trim()
  if (!title || Array.from(title).length > 160) throw new Error('对话名称需为 1–160 个字符')
  return title
}
