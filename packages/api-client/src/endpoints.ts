import { extensionEndpoints } from './extension-endpoints'
import type { Transport } from './transport/ports'
import { codingEndpoints } from './coding-endpoints'
import { imageEndpoints } from './image-endpoints'
import { audioEndpoints } from './audio-endpoints'
import { decodeSpeech } from './audio-decoders'
import { decodeCatalog } from './model-catalog'
import { decodeRuntimeMetrics } from './runtime-metrics'
import { attachmentEndpoints } from './attachments'
import { decodeSource, type MessageSource } from './chat-sources'
import { webSearchEndpoints, type ChatAttempt } from './web-search'
import type { components } from './generated-schema'
import { list, record, text, number, nullableText, malformed } from './decoders'

type ModelSchema = components['schemas']['ModelView']
export interface ModelSummary
  extends Pick<
    ModelSchema,
    | 'id'
    | 'displayName'
    | 'source'
    | 'engine'
    | 'task'
    | 'localPath'
    | 'inputModalities'
    | 'outputModalities'
    | 'capabilities'
  > {
  state: string
  contextLength: number | null
  installationId: string
  managedInstallation: boolean
  artifactIdentity: string | null
  speech?: ModelSchema['speech']
  inputLimits?: { maxImages: number }
}
export interface Attachment {
  id: string
  mimeType: string
  originalName: string
  preparationId?: string
}
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  turnId: string
  attachments: Attachment[]
  parameters: Record<string, unknown>
  sources?: MessageSource[]
}
export type ConversationPatch = components['schemas']['ConversationPatch']
export interface Conversation
  extends Pick<components['schemas']['ConversationView'], 'pinned' | 'nextCursor' | 'activeJobId'> {
  id: string
  title: string
  modelId: string | null
  messages: Message[]
  webSearchEnabled?: boolean
}
export interface Submission {
  jobId: string
  state: string
  userMessageId?: string
  turnId?: string
}
export interface JobSnapshot {
  errorCode?: string | null
  id: string
  state: string
  text: string
  event_sequence: number
  instance_id: string
  phase?: string
  projectionVersion?: number
  textRevision?: number
  sources?: MessageSource[]
}
export type ChatCommand = components['schemas']['ChatMessageRequest']
const root = '/internal/v1'
const idPath = (id: string): string => encodeURIComponent(id)

export function decodeModel(value: unknown): ModelSummary {
  const item = record(value)
  const capabilities = record(item.capabilities)
  if (typeof item.managedInstallation !== 'boolean') throw malformed()
  const decodedCapabilities: Record<string, boolean> = {}
  let inputLimits: ModelSummary['inputLimits']
  if (item.inputLimits != null) {
    const maxImages = number(record(item.inputLimits).maxImages)
    if (!Number.isInteger(maxImages) || maxImages < 0 || maxImages > 4) throw malformed()
    inputLimits = { maxImages }
  }
  for (const [key, value] of Object.entries(capabilities)) {
    if (typeof value !== 'boolean') throw malformed()
    decodedCapabilities[key] = value
  }
  return {
    id: text(item.id),
    installationId: nullableText(item.installationId) ?? text(item.id),
    managedInstallation: item.managedInstallation,
    artifactIdentity: nullableText(item.artifactIdentity),
    displayName: text(item.displayName),
    source: text(item.source),
    engine: text(item.engine),
    task: text(item.task),
    state: text(item.state),
    localPath: text(item.localPath),
    inputModalities: list(item.inputModalities, text),
    outputModalities: list(item.outputModalities, text),
    capabilities: decodedCapabilities,
    inputLimits,
    contextLength:
      item.contextLength === null || item.contextLength === undefined
        ? null
        : number(item.contextLength),
    speech: decodeSpeech(item.speech),
  }
}
export function decodeMessage(value: unknown): Message {
  const item = record(value)
  const role = text(item.role)
  if (role !== 'user' && role !== 'assistant' && role !== 'system') throw malformed()
  return {
    id: text(item.id),
    role,
    content: text(item.content),
    turnId: text(item.turnId),
    parameters: record(item.parameters),
    attachments: list(item.attachments, (value) => {
      const attachment = record(value)
      return {
        id: text(attachment.id),
        mimeType: text(attachment.mimeType),
        originalName: text(attachment.originalName),
        preparationId:
          attachment.preparationId == null ? undefined : text(attachment.preparationId),
      }
    }),
    sources: list(item.sources ?? [], decodeSource),
  }
}
export function decodeConversation(value: unknown): Conversation {
  const item = record(value)
  if (item.pinned !== undefined && typeof item.pinned !== 'boolean') throw malformed()
  if (item.webSearchEnabled !== undefined && typeof item.webSearchEnabled !== 'boolean')
    throw malformed()
  return {
    activeJobId: item.activeJobId == null ? null : text(item.activeJobId),
    nextCursor: item.nextCursor == null ? null : text(item.nextCursor),
    pinned: item.pinned === true,
    id: text(item.id),
    title: text(item.title),
    modelId: nullableText(item.modelId),
    messages: item.messages === undefined ? [] : list(item.messages, decodeMessage),
    webSearchEnabled: item.webSearchEnabled === true,
  }
}
export function decodeSubmission(value: unknown): Submission {
  const item = record(value)
  return {
    jobId: text(item.jobId),
    state: text(item.state),
    userMessageId: item.userMessageId == null ? undefined : text(item.userMessageId),
    turnId: item.turnId == null ? undefined : text(item.turnId),
  }
}
export function createEndpoints(transport: Transport) {
  return {
    images: imageEndpoints(transport),
    audio: audioEndpoints(transport),
    coding: codingEndpoints(transport),
    extensions: extensionEndpoints(transport),
    attachments: attachmentEndpoints(transport),
    webSearch: webSearchEndpoints(transport),
    jobs: {
      get: async (id: string): Promise<JobSnapshot> => {
        const item = record(await transport.get(`${root}/jobs/${idPath(id)}`))
        return {
          id: text(item.id),
          state: text(item.state),
          errorCode: nullableText(item.errorCode),
          text: text(item.text),
          event_sequence: number(item.event_sequence),
          instance_id: text(item.instance_id),
          phase: item.phase == null ? undefined : text(item.phase),
          projectionVersion:
            item.projectionVersion == null ? undefined : number(item.projectionVersion),
          textRevision: item.textRevision == null ? undefined : number(item.textRevision),
          sources: list(item.sources ?? [], decodeSource),
        }
      },
    },
    models: {
      catalog: async (query: string) =>
        decodeCatalog(
          await transport.get(`${root}/models/catalog?query=${encodeURIComponent(query)}`),
        ),
      list: async (signal?: AbortSignal) =>
        list(await transport.get(`${root}/models`, signal), decodeModel),
      unload: (id: string) => transport.post(`${root}/models/${idPath(id)}/unload`),
      load: (id: string) => transport.post(`${root}/models/${idPath(id)}/load`),
      unregister: (id: string) => transport.delete(`${root}/models/${idPath(id)}/registration`),
      deleteFiles: (id: string) =>
        transport.delete(`${root}/models/${idPath(id)}/files?confirm=true`),
      import: (path: string) => transport.post(`${root}/models/import`, { path }),
      pull: (repo_id: string) => transport.post(`${root}/models/pull`, { repo_id }),
    },
    conversations: {
      attempt: async (id: string, user: string, body: ChatAttempt) =>
        decodeSubmission(
          await transport.post(
            `${root}/conversations/${idPath(id)}/messages/${idPath(user)}/attempts`,
            body,
          ),
        ),
      list: async (signal?: AbortSignal) =>
        list(await transport.get(`${root}/conversations`, signal), decodeConversation),
      get: async (id: string, signal?: AbortSignal) =>
        decodeConversation(await transport.get(`${root}/conversations/${idPath(id)}`, signal)),
      page: async (id: string, before: string, signal?: AbortSignal) =>
        decodeConversation(
          await transport.get(
            `${root}/conversations/${idPath(id)}?before=${encodeURIComponent(before)}`,
            signal,
          ),
        ),
      create: async (model_id: string) =>
        decodeConversation(
          await transport.post(`${root}/conversations`, { title: '新对话', model_id }),
        ),
      delete: (id: string) => transport.delete(`${root}/conversations/${idPath(id)}`),
      update: async (id: string, body: ConversationPatch) =>
        decodeConversation(await transport.patch(`${root}/conversations/${idPath(id)}`, body)),
      submit: async (id: string, body: ChatCommand, signal?: AbortSignal) =>
        decodeSubmission(
          await transport.post(
            `${root}/conversations/${idPath(id)}/messages`,
            body,
            ...(signal ? [signal] : []),
          ),
        ),
      cancel: (id: string, job: string) =>
        transport.post(`${root}/conversations/${idPath(id)}/cancel?job_id=${idPath(job)}`),
    },
    runtime: {
      info: async (signal?: AbortSignal) =>
        record(await transport.get(`${root}/runtime/info`, signal)),
      metrics: async (signal?: AbortSignal) =>
        decodeRuntimeMetrics(await transport.get(`${root}/runtime/metrics`, signal)),
      restart: () => transport.post(`${root}/runtime/restart-worker`),
    },
  }
}
