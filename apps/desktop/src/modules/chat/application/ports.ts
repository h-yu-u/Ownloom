import type {
  Conversation,
  ConversationPatch,
  JobSnapshot,
  ChatCommand,
  ChatAttempt,
  Submission,
} from '@mlx-studio/api-client'
import type { ChatSubmissionGateway } from './submit-chat'
/** Read-only query models are shared contracts; submission rules remain independent. */
export interface ChatGateway extends ChatSubmissionGateway {
  list(): Promise<Conversation[]>
  page?(id: string, before: string, signal?: AbortSignal): Promise<Conversation>
  get(id: string, signal?: AbortSignal): Promise<Conversation>
  create(modelId: string): Promise<Conversation>
  update(id: string, patch: ConversationPatch): Promise<Conversation>
  delete(id: string): Promise<unknown>
  cancel(id: string, job: string): Promise<unknown>
  job(id: string): Promise<JobSnapshot>
  webSearch?(): Promise<ChatCommand['web_search']>
  attempt?(id: string, user: string, input: ChatAttempt): Promise<Submission>
}
