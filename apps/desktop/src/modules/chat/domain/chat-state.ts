import type { MessageSource } from './message-source'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  state?: 'streaming' | 'complete' | 'error' | 'cancelled'
  finishReason?: 'length'
  attachments?: Array<{
    id: string
    originalName: string
    mimeType: string
    preparationId?: string
  }>
  sources?: MessageSource[]
  parameters?: Record<string, unknown>
  turnId?: string
}

export interface ChatState {
  messages: ChatMessage[]
  activeJobId: string | null
  status: 'idle' | 'loading' | 'sending' | 'error'
  errorCode?: string
  error: string | null
}

export type ChatEvent =
  | { type: 'send.started'; userMessage: ChatMessage; assistantMessage: ChatMessage }
  | { type: 'generation.delta'; jobId: string; text: string }
  | { type: 'generation.completed'; jobId: string; finishReason?: 'length' }
  | { type: 'generation.cancelled'; jobId: string }
  | { type: 'generation.failed'; jobId: string; message: string; code?: string }
  | { type: 'conversation.loaded'; messages: ChatMessage[] }
  | { type: 'reset' }

export const initialChatState: ChatState = {
  messages: [],
  activeJobId: null,
  status: 'idle',
  error: null,
}

export function reduceChatState(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'send.started':
      return {
        ...state,
        messages: [...state.messages, event.userMessage, event.assistantMessage],
        activeJobId: event.assistantMessage.id,
        status: 'sending',
        error: null,
      }
    case 'generation.delta':
      if (state.activeJobId !== event.jobId) return state
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === event.jobId
            ? { ...message, content: message.content + event.text }
            : message,
        ),
      }
    case 'generation.completed':
    case 'generation.cancelled':
      if (state.activeJobId !== event.jobId) return state
      return {
        ...state,
        activeJobId: null,
        status: 'idle',
        messages: state.messages.map((message) =>
          message.id === event.jobId
            ? {
                ...message,
                state: event.type === 'generation.completed' ? 'complete' : 'cancelled',
                finishReason:
                  event.type === 'generation.completed' ? event.finishReason : undefined,
              }
            : message,
        ),
      }
    case 'generation.failed':
      if (state.activeJobId !== event.jobId) return state
      return {
        ...state,
        activeJobId: null,
        status: 'error',
        error: event.message,
        errorCode: event.code,
        messages: state.messages.map((message) =>
          message.id === event.jobId ? { ...message, state: 'error' } : message,
        ),
      }
    case 'conversation.loaded':
      return { ...state, messages: event.messages, activeJobId: null, status: 'idle', error: null }
    case 'reset':
      return initialChatState
  }
}
