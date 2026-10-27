import {
  createEndpoints,
  type ConversationPatch,
  type RuntimeClient,
  type ChatAttempt,
} from '@mlx-studio/api-client'
import type { ChatSubmissionGateway } from '../application/submit-chat'

export function createChatGateway(provider: () => Promise<RuntimeClient>) {
  const endpoints = async () => createEndpoints(await provider())
  return {
    list: async () => (await endpoints()).conversations.list(),
    get: async (id: string, signal?: AbortSignal) =>
      (await endpoints()).conversations.get(id, signal),
    page: async (id: string, before: string, signal?: AbortSignal) =>
      (await endpoints()).conversations.page(id, before, signal),
    create: async (modelId: string) => (await endpoints()).conversations.create(modelId),
    update: async (id: string, patch: ConversationPatch) =>
      (await endpoints()).conversations.update(id, patch),
    delete: async (id: string) => (await endpoints()).conversations.delete(id),
    cancel: async (id: string, job: string) => (await endpoints()).conversations.cancel(id, job),
    upload: async (file: File) => (await provider()).uploadImage(file),
    sequence: async () => Number((await (await endpoints()).runtime.info()).event_sequence),
    submit: async (...args: Parameters<ChatSubmissionGateway['submit']>) =>
      (await endpoints()).conversations.submit(...args),
    job: async (id: string) => (await endpoints()).jobs.get(id),
    webSearch: async () => {
      const settings = await (await endpoints()).webSearch.get()
      if (!settings.credentialConfigured) throw new Error('请先在设置中配置联网搜索')
      return { enabled: true, config_id: settings.id, config_revision: settings.revision }
    },
    attempt: async (id: string, user: string, input: ChatAttempt) =>
      (await endpoints()).conversations.attempt(id, user, input),
  }
}
export type ChatGateway = ReturnType<typeof createChatGateway>
