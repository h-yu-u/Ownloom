import type { Ref } from 'vue'
import type { ChatAttempt } from '@mlx-studio/api-client'
import type { ChatGateway } from '../application/ports'
import type { ChatState } from '../domain/chat-state'
import type { RequestScope } from '../../../capabilities/requests'
import { projectAttempt } from './chat-projection'

export function createChatAttempts(options: {
  gateway: ChatGateway
  state: Ref<ChatState>
  conversationId: Ref<string | null>
  pending: Ref<boolean>
  navigating: Readonly<Ref<boolean>>
  view: Pick<RequestScope, 'owner' | 'owns'>
  refresh(): Promise<void>
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
    const owner = options.view.owner,
      target = conversationId.value
    if (
      pending.value ||
      options.navigating.value ||
      !options.view.owns(owner) ||
      state.value.activeJobId ||
      !target ||
      !gateway.attempt
    )
      return
    pending.value = true
    try {
      const key = JSON.stringify([
        target,
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
      const result = await gateway.attempt(target, userId, retry.body)
      retry = undefined
      if (!options.view.owns(owner) || target !== conversationId.value) return
      state.value = projectAttempt(state.value, result.jobId)
      options.start(result.jobId, after)
    } finally {
      pending.value = false
      if (!options.view.owns(owner) && options.view.owns(options.view.owner)) void options.refresh()
    }
  }
}
