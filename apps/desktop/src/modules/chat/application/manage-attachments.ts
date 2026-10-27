import type { AttachmentMetadata } from '@mlx-studio/api-client'
import { attachmentPolicy, describeFile } from '../domain/attachment-policy'
import type { DraftAttachment } from '../domain/chat-draft'
import { ChatDrafts } from './chat-drafts'
import type { AttachmentGateway } from './attachment-ports'

/** Byte handles, aborts and timers stay outside serializable domain drafts. */
export class ManageAttachments {
  private files = new Map<string, File>()
  private epochs = new Map<string, number>()
  private controllers = new Map<string, AbortController>()
  private leases = new Map<string, Promise<unknown>>()
  private pendingLeases = new Set<string>()
  private activeDraftKeys = new Set<string>()
  private leaseTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  private queue: Array<() => Promise<void>> = []
  private active = 0
  constructor(
    private readonly drafts: ChatDrafts,
    private readonly gateway: AttachmentGateway,
    private readonly report: (message: string) => void,
    private readonly delay: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async add(key: string, files: readonly File[]): Promise<void> {
    const draft = this.drafts.get(key)
    const accepted: DraftAttachment[] = [...draft.attachments]
    const added: string[] = []
    for (const file of files) {
      const descriptor = describeFile(file.name)
      const reason = !descriptor
        ? '支持图片、TXT、MD、DOCX、PDF；旧版 DOC 请先转换'
        : file.size > attachmentPolicy.maxFileBytes
          ? '文件超过 20 MiB'
          : accepted.length >= attachmentPolicy.maxCount
            ? '最多 8 个附件'
            : accepted.reduce((sum, item) => sum + item.sizeBytes, 0) + file.size >
                attachmentPolicy.maxTotalBytes
              ? '总大小超过 60 MiB'
              : undefined
      if (reason || !descriptor) {
        this.report(`${file.name}：${reason}`)
        continue
      }
      const clientId = crypto.randomUUID()
      accepted.push({
        clientId,
        uploadKey: crypto.randomUUID(),
        originalName: file.name,
        sizeBytes: file.size,
        ...descriptor,
        transfer: 'local',
        processing: 'waiting',
        processingRevision: 0,
        warnings: [],
        retryable: true,
      })
      this.files.set(clientId, file)
      this.epochs.set(clientId, 0)
      added.push(clientId)
    }
    if (!added.length) return
    this.drafts.edit(
      key,
      {
        attachments: accepted,
        visualSelection:
          accepted.some((item) => added.includes(item.clientId) && item.kind === 'image') &&
          draft.visualSelection.mode === 'none'
            ? { mode: 'auto' }
            : draft.visualSelection,
      },
      true,
    )
    for (const id of added) this.enqueue(() => this.transfer(key, id))
    this.activeDraftKeys.add(key)
    this.scheduleLeases()
  }
  remove(key: string, clientId: string): void {
    this.invalidate(clientId)
    this.files.delete(clientId)
    const draft = this.drafts.get(key)
    this.drafts.edit(
      key,
      { attachments: draft.attachments.filter((item) => item.clientId !== clientId) },
      true,
    )
    void this.sync(key).catch((error) => this.report(errorText(error)))
    this.scheduleLeases()
  }
  retry(key: string, clientId: string): void {
    this.invalidate(clientId)
    const item = this.item(key, clientId)
    if (!item) return
    if (item.attachmentId) this.enqueue(() => this.reprepare(key, clientId))
    else this.enqueue(() => this.transfer(key, clientId))
  }
  consumed(key: string, revision: number): void {
    const items = this.drafts.get(key).attachments
    if (!this.drafts.consume(key, revision)) return
    for (const item of items) {
      this.invalidate(item.clientId)
      this.files.delete(item.clientId)
    }
    void this.sync(key).catch((error) => this.report(errorText(error)))
    this.scheduleLeases()
  }
  close(key: string): void {
    const draft = this.drafts.get(key)
    for (const item of draft.attachments) {
      this.invalidate(item.clientId)
      this.files.delete(item.clientId)
    }
    this.drafts.edit(key, { text: '', attachments: [] }, true)
    void this.gateway
      .close(draft.id)
      .catch((error) => this.report(errorText(error)))
      .finally(() => {
        this.leases.delete(draft.id)
        this.pendingLeases.delete(draft.id)
      })
    this.scheduleLeases()
  }
  sync(key: string): Promise<unknown> {
    const draft = this.drafts.get(key)
    const previous = this.leases.get(draft.id) ?? Promise.resolve()
    this.pendingLeases.add(draft.id)
    const next: Promise<unknown> = previous
      .catch(() => undefined)
      .then(() =>
        this.gateway.lease(draft.id, {
          revision: draft.selectionRevision,
          attachment_ids: [],
          client_upload_ids: draft.attachments.map((item) => item.uploadKey),
        }),
      )
      .finally(() => {
        if (this.leases.get(draft.id) === next) this.pendingLeases.delete(draft.id)
      })
    this.leases.set(draft.id, next)
    return next
  }
  private scheduleLeases(): void {
    if (this.disposed) return
    for (const key of this.activeDraftKeys) {
      if (!this.drafts.get(key).attachments.length) this.activeDraftKeys.delete(key)
    }
    if (!this.activeDraftKeys.size) {
      clearTimeout(this.leaseTimer)
      this.leaseTimer = undefined
      return
    }
    if (this.leaseTimer) return
    this.leaseTimer = setTimeout(
      () => {
        this.leaseTimer = undefined
        for (const key of this.activeDraftKeys) {
          if (!this.pendingLeases.has(this.drafts.get(key).id))
            void this.sync(key).catch((error) => this.report(errorText(error)))
        }
        this.scheduleLeases()
      },
      15 * 60 * 1000,
    )
  }
  dispose(): void {
    this.disposed = true
    clearTimeout(this.leaseTimer)
    this.leaseTimer = undefined
    this.activeDraftKeys.clear()
    this.queue = []
    for (const id of this.controllers.keys()) this.invalidate(id)
    this.files.clear()
  }
  private item(key: string, id: string): DraftAttachment | undefined {
    return this.drafts.get(key).attachments.find((item) => item.clientId === id)
  }
  private invalidate(id: string): void {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1)
    this.controllers.get(id)?.abort()
    this.controllers.delete(id)
  }
  private operation(key: string, id: string) {
    const epoch = this.epochs.get(id) ?? 0
    const controller = new AbortController()
    this.controllers.set(id, controller)
    return {
      signal: controller.signal,
      valid: () => epoch === this.epochs.get(id) && Boolean(this.item(key, id)),
    }
  }
  private async transfer(key: string, id: string): Promise<void> {
    const item = this.item(key, id),
      file = this.files.get(id)
    if (!item || !file) return
    const operation = this.operation(key, id)
    this.drafts.item(key, id, (item) => ({ ...item, transfer: 'uploading', error: undefined }))
    try {
      await this.sync(key)
      if (!operation.valid()) return
      const draft = this.drafts.get(key)
      const metadata = await this.gateway.upload(
        file,
        { uploadId: item.uploadKey, draftId: draft.id, revision: draft.selectionRevision },
        operation.signal,
      )
      if (!operation.valid()) return
      this.apply(key, id, metadata)
      this.files.delete(id)
      void this.sync(key).catch((error) => this.report(errorText(error)))
      await this.observe(key, id, metadata, operation)
    } catch (error) {
      if (operation.valid())
        this.drafts.item(key, id, (item) => ({
          ...item,
          transfer: item.attachmentId ? 'stored' : 'failed',
          error: errorText(error),
          retryable: true,
        }))
    }
  }
  private async reprepare(key: string, id: string): Promise<void> {
    const item = this.item(key, id)
    if (!item?.attachmentId) return
    const operation = this.operation(key, id)
    try {
      const metadata = await this.gateway.retry(item.attachmentId)
      if (!operation.valid()) return
      this.apply(key, id, metadata)
      await this.observe(key, id, metadata, operation)
    } catch (error) {
      if (operation.valid())
        this.drafts.item(key, id, (item) => ({
          ...item,
          processing: 'failed',
          error: errorText(error),
          retryable: true,
        }))
    }
  }
  private async observe(
    key: string,
    id: string,
    initial: AttachmentMetadata,
    operation: { signal: AbortSignal; valid(): boolean },
  ): Promise<void> {
    let metadata = initial,
      pause = 400
    while (
      operation.valid() &&
      (!metadata.processing || ['queued', 'preparing'].includes(metadata.processing.state))
    ) {
      await this.delay(pause)
      if (!operation.valid()) return
      metadata = await this.gateway.metadata(metadata.id, operation.signal)
      if (!operation.valid()) return
      this.apply(key, id, metadata)
      pause = Math.min(pause * 1.5, 4000)
    }
  }
  private apply(key: string, id: string, metadata: AttachmentMetadata): void {
    this.drafts.item(key, id, (item) => {
      const preparation = metadata.processing
      if (
        preparation &&
        preparation.preparationId === item.preparationId &&
        preparation.revision < item.processingRevision
      )
        return item
      return {
        ...item,
        attachmentId: metadata.id,
        transfer: 'stored',
        kind: metadata.kind,
        format: metadata.format,
        processing: preparation?.state ?? 'waiting',
        preparationId: preparation?.preparationId,
        processingRevision: preparation?.revision ?? 0,
        pageCount: preparation?.pageCount ?? undefined,
        warnings: preparation?.warnings ?? [],
        retryable: preparation?.retryable ?? true,
        error: preparation?.errorCode ?? undefined,
      }
    })
  }
  private enqueue(task: () => Promise<void>): void {
    if (this.disposed) return
    this.queue.push(task)
    this.pump()
  }
  private pump(): void {
    while (this.active < 2 && this.queue.length) {
      const task = this.queue.shift()!
      this.active++
      void task()
        .catch((error) => this.report(errorText(error)))
        .finally(() => {
          this.active--
          this.pump()
        })
    }
  }
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '附件处理失败'
}
