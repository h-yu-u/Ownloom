import type { Conversation, JobSnapshot } from '@mlx-studio/api-client'
import { reduceChatState, type ChatMessage, type ChatState } from '../domain/chat-state'

export function projectJobSnapshot(state: ChatState, snapshot: JobSnapshot): ChatState {
  return {
    ...state,
    messages: state.messages.map((item) =>
      item.id === snapshot.id
        ? {
            ...item,
            content: snapshot.text,
            sources: snapshot.sources ?? [],
            generationStats: snapshot.generationStats ?? null,
          }
        : item,
    ),
  }
}

/** Convert durable records and accepted receipts without owning requests or observers. */
export function projectConversation(state: ChatState, item: Conversation): ChatState {
  const messages: ChatMessage[] = item.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      ...message,
      role: message.role === 'user' ? 'user' : 'assistant',
      state: 'complete',
      finishReason: message.parameters.finishReason === 'length' ? 'length' : undefined,
    }))
  const loaded = reduceChatState(state, { type: 'conversation.loaded', messages })
  return item.activeJobId
    ? {
        ...loaded,
        status: 'sending',
        activeJobId: item.activeJobId,
        messages: [
          ...messages,
          { id: item.activeJobId, role: 'assistant', content: '', state: 'streaming' },
        ],
      }
    : loaded
}

export function projectSubmission(
  state: ChatState,
  receipt: {
    messageId: string
    jobId: string
    content: string
    attachments: ChatMessage['attachments']
  },
): ChatState {
  return reduceChatState(state, {
    type: 'send.started',
    userMessage: {
      id: receipt.messageId,
      role: 'user',
      content: receipt.content,
      state: 'complete',
      attachments: receipt.attachments,
    },
    assistantMessage: { id: receipt.jobId, role: 'assistant', content: '', state: 'streaming' },
  })
}

/** Keep the previous successful answer until its replacement is durably completed. */
export function projectAttempt(state: ChatState, jobId: string): ChatState {
  return {
    ...state,
    status: 'sending',
    activeJobId: jobId,
    error: null,
    messages: [
      ...state.messages.filter((item) => item.state !== 'error' && item.state !== 'cancelled'),
      { id: jobId, role: 'assistant', content: '', state: 'streaming' },
    ],
  }
}
