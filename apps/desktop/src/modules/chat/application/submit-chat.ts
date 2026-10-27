import type { ChatCommand } from '@mlx-studio/api-client'
import type { ChatDraft, VisualSelection } from '../domain/chat-draft'
export interface ChatAttachment {
  id: string
  mimeType: string
  originalName: string
  preparationId?: string
}
export interface ChatSubmissionInput {
  conversationId: string
  content: string
  files: File[]
  modelId: string
  maxTokens: number | null
  temperature: number
  attachments?: ChatAttachment[]
  selection?: ChatCommand['selection']
  webSearch?: ChatCommand['web_search']
  visualSelection?: VisualSelection
  draftIdentity?: string
  webSearchProvider?: () => Promise<ChatCommand['web_search']>
}
export interface ChatSubmissionGateway {
  upload(file: File): Promise<ChatAttachment>
  sequence(): Promise<number>
  submit(id: string, input: ChatCommand): Promise<{ jobId: string; userMessageId?: string }>
}
export function submissionAttachments(draft?: ChatDraft): ChatAttachment[] | undefined {
  return draft?.attachments.flatMap((item) =>
    item.attachmentId
      ? [
          {
            id: item.attachmentId,
            mimeType: item.kind === 'image' ? `image/${item.format}` : 'application/octet-stream',
            originalName: item.originalName,
            preparationId: item.preparationId,
          },
        ]
      : [],
  )
}
/** The exact body and request identity survive transport failure. Per-file successes survive batch failure. */
export class SubmitChat {
  private running = false
  private retry?: {
    key: string
    files: File[]
    requestId: string
    attachments: Array<ChatAttachment | undefined>
    body?: ChatCommand
  }
  constructor(private readonly gateway: ChatSubmissionGateway) {}
  async run(input: ChatSubmissionInput) {
    if (this.running) return undefined
    this.running = true
    try {
      const key = JSON.stringify({
        ...input,
        files: input.files.map((file) => [file.name, file.size, file.lastModified]),
      })
      if (
        this.retry?.key !== key ||
        this.retry.files.some((file, index) => file !== input.files[index])
      ) {
        this.retry = {
          key,
          files: [...input.files],
          requestId: crypto.randomUUID(),
          attachments: [],
        }
      }
      const retry = this.retry
      const results = await Promise.allSettled(
        input.files.map(async (file, index) => {
          retry.attachments[index] ??= await this.gateway.upload(file)
        }),
      )
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      const attachments =
        input.attachments ??
        retry.attachments.filter((item): item is ChatAttachment => item !== undefined)
      retry.body ??= {
        content: input.content,
        ...(input.selection ? { selection: input.selection } : {}),
        model_id: input.modelId,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        attachment_ids: attachments.map((item) => item.id),
        client_request_id: retry.requestId,
        web_search: (await input.webSearchProvider?.()) ?? input.webSearch ?? { enabled: false },
        visual_selection:
          input.visualSelection?.mode === 'explicit'
            ? { mode: 'explicit', attachment_ids: [...input.visualSelection.attachmentIds] }
            : input.visualSelection,
      }
      const after = await this.gateway.sequence()
      const result = await this.gateway.submit(input.conversationId, retry.body)
      this.retry = undefined
      return {
        jobId: result.jobId,
        userMessageId: result.userMessageId,
        after,
        content: input.content,
        ...(input.selection ? { selection: input.selection } : {}),
        attachments,
      }
    } finally {
      this.running = false
    }
  }
}
