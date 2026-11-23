import type { Conversation } from '@mlx-studio/api-client'
import { ref, type Ref } from 'vue'
import type { ChatGateway } from '../application/ports'
import type { ChatState } from '../domain/chat-state'

export function createChatHistory(state: Ref<ChatState>, page: ChatGateway['page']) {
  const nextCursor = ref<string | null>(null)
  const error = ref<string | null>(null)

  function reset(cursor: string | null = null): void {
    nextCursor.value = cursor
    error.value = null
  }

  async function loadMore(id: string, ownsView: () => boolean): Promise<void> {
    const cursor = nextCursor.value
    if (!cursor || !page) return
    const current = () => ownsView() && nextCursor.value === cursor
    error.value = null
    let result: Conversation
    try {
      result = await page(id, cursor)
    } catch (cause) {
      if (current()) error.value = cause instanceof Error ? cause.message : '聊天历史读取失败'
      return
    }
    if (!current()) return
    const known = new Set(state.value.messages.map((item) => item.id))
    const older = result.messages
      .filter((item) => !known.has(item.id))
      .map((item) => ({
        ...item,
        role: item.role === 'user' ? ('user' as const) : ('assistant' as const),
        state: 'complete' as const,
      }))
    state.value = { ...state.value, messages: [...older, ...state.value.messages] }
    reset(result.nextCursor ?? null)
  }

  return { nextCursor, error, reset, loadMore }
}
