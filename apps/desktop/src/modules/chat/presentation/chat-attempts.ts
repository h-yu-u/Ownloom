import type { Ref } from 'vue'
import type { ChatAttempt } from '@mlx-studio/api-client'
import type { ChatGateway } from '../application/ports'
import type { ChatState } from '../domain/chat-state'

export function createChatAttempts(options: {
  gateway: ChatGateway
  state: Ref<ChatState>
  conversationId: Ref<string | null>
  pending: Ref<boolean>
  modelId: Ref<string>
  maxTokens: Ref<number | null>
  temperature: Ref<number>
  start(id: string, after: number): void
}) {
  let retry: { key: string; body: ChatAttempt } | undefined
  return async function attempt(
    userId: string,
    mode: ChatAttempt['mode'],
    sourceJob?: string,
  ): Promise<void> {
    const { gateway, state, conversationId, pending } = options
    if (pending.value || state.value.activeJobId || !conversationId.value || !gateway.attempt)
      return
    pending.value = true
    try {
      const key = JSON.stringify([
        conversationId.value,
        userId,
        mode,
        sourceJob,
        options.modelId.value,
        options.maxTokens.value,
        options.temperature.value,
      ])
      if (retry?.key !== key)
        retry = {
          key,
          body: {
            client_request_id: crypto.randomUUID(),
            mode,
            source_context_job_id: sourceJob,
            model_id: options.modelId.value,
            max_tokens: options.maxTokens.value,
            temperature: options.temperature.value,
            web_search: mode === 'refresh_web' ? await gateway.webSearch?.() : { enabled: false },
          },
        }
      const after = await gateway.sequence()
      const result = await gateway.attempt(conversationId.value, userId, retry.body)
      retry = undefined
      // Keep the previous successful answer until the replacement is durably completed.
      state.value = {
        ...state.value,
        status: 'sending',
        activeJobId: result.jobId,
        error: null,
        messages: [
          ...state.value.messages.filter(
            (item) => item.state !== 'error' && item.state !== 'cancelled',
          ),
          { id: result.jobId, role: 'assistant', content: '', state: 'streaming' },
        ],
      }
      options.start(result.jobId, after)
    } finally {
      pending.value = false
    }
  }
}
