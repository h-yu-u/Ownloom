export { RuntimeClient } from './transport/client'
export type { RuntimeClientOptions } from './transport/client'
export { RuntimeSession } from './session'
export { RuntimeError } from './errors'
export type { RuntimeMetrics } from './runtime-metrics'
export { createEndpoints } from './endpoints'
export type { AttachmentMetadata, Processing, TextPreview, DraftSelection } from './attachments'
export { decodeAttachment, decodeTextPreview } from './attachments'
export type { MessageSource } from './chat-sources'
export { decodeSource } from './chat-sources'
export type { WebSettings, WebSettingsUpdate, ChatAttempt } from './web-search'
export type {
  ModelSummary,
  Conversation,
  ConversationPatch,
  Message,
  Submission,
  ChatCommand,
  JobSnapshot,
} from './endpoints'
export type { RuntimeConnection, RuntimeEvent } from './types'
export type { components } from './generated-schema'
export { readJob as decodeImageJob } from './image-endpoints'

export * from './coding-decoders'
export { codingEndpoints } from './coding-endpoints'
export { decodeCodingProjection, type CodingProjection } from './coding-projection'

export * from './extension-decoders'
export { extensionEndpoints } from './extension-endpoints'
export {
  textAssistantEndpoints,
  type TextAssistantRequest,
  type TextAssistantView,
} from './text-assistant'
export {
  agentChatEndpoints,
  type AgentSession,
  type AgentChatSnapshot,
  type AgentChatRequest,
} from './agent-chat'

export type { WebTestResult } from './web-search'
export { copyExtensionSelection } from './extension-selection'

export { codingLimits } from './coding-limits'

export {
  dataEndpoints,
  type TaskSummary,
  type StorageView,
  type DownloadView,
} from './data-endpoints'
