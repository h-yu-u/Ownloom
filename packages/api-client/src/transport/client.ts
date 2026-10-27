import { decodeCodingEvent, type CodingEvent } from '../coding-decoders'
import { record, text } from '../decoders'
/** Authenticated transport boundary for the local Runtime. */

import { RuntimeEventStreamParser } from '../sse'
import type { RuntimeConnection, RuntimeEvent } from '../types'
import { createEndpoints } from '../endpoints'
import { decodeError } from '../errors'
import { decodeAudioAsset } from '../audio-decoders'
import { decodeAttachment } from '../attachments'

export type { ModelSummary, Conversation, Message, Submission, ChatCommand } from '../endpoints'

export type { RuntimeConnection, RuntimeEvent } from '../types'
export type { components } from '../generated-schema'

export interface RuntimeClientOptions {
  onConnectionInvalid?: () => void
}

export class RuntimeClient {
  readonly endpoints = createEndpoints(this)
  constructor(
    private readonly connection: RuntimeConnection,
    private readonly options: RuntimeClientOptions = {},
  ) {}

  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(path, { method: 'GET', signal })
  }

  async post(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  }

  async patch(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async put(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async uploadAttachment(
    file: File,
    options: { uploadId: string; draftId: string; revision: number },
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      filename: file.name,
      client_upload_id: options.uploadId,
      draft_id: options.draftId,
      draft_revision: String(options.revision),
    })
    const response = await this.fetch(`/internal/v1/attachments?${query}`, {
      method: 'POST',
      body: file,
      signal,
    })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) throw decodeError(payload, response.status)
    return decodeAttachment(payload)
  }

  async attachmentThumbnail(id: string, preparation: string, signal?: AbortSignal): Promise<Blob> {
    const response = await this.fetch(
      `/internal/v1/attachments/${encodeURIComponent(id)}/preview?view=thumbnail&preparation_id=${encodeURIComponent(preparation)}`,
      { signal },
    )
    if (!response.ok)
      throw decodeError(await response.json().catch(() => undefined), response.status)
    return response.blob()
  }

  async delete(path: string): Promise<unknown> {
    return this.request(path, { method: 'DELETE' })
  }

  async uploadImage(file: File): Promise<{ id: string; mimeType: string; originalName: string }> {
    const response = await this.fetch(
      `/internal/v1/attachments?filename=${encodeURIComponent(file.name)}`,
      { method: 'POST', body: file },
    )
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      throw decodeError(payload, response.status)
    }
    const item = record(payload)
    return {
      id: text(item.id),
      mimeType: text(item.mimeType),
      originalName: text(item.originalName),
    }
  }

  async downloadImageArtifact(id: string, signal?: AbortSignal, thumbnail = false): Promise<Blob> {
    const response = await this.fetch(
      `/internal/v1/image-artifacts/${encodeURIComponent(id)}/content?thumbnail=${thumbnail}`,
      { signal },
    )
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined)
      throw decodeError(payload, response.status)
    }
    return response.blob()
  }

  async uploadAudio(file: File) {
    const response = await this.fetch(
      `/internal/v1/audio-assets?filename=${encodeURIComponent(file.name)}`,
      { method: 'POST', body: file },
    )
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) throw decodeError(payload, response.status)
    return decodeAudioAsset(payload)
  }

  async downloadAudio(id: string, role: 'asset' | 'artifact', signal?: AbortSignal): Promise<Blob> {
    const collection = role === 'asset' ? 'audio-assets' : 'audio-artifacts'
    const response = await this.fetch(
      `/internal/v1/${collection}/${encodeURIComponent(id)}/content`,
      { signal },
    )
    if (!response.ok)
      throw decodeError(await response.json().catch(() => undefined), response.status)
    return response.blob()
  }

  async inspectBackup(file: File) {
    const response = await this.fetch('/internal/v1/storage/restore/preview', {
      method: 'POST',
      body: file,
    })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) throw decodeError(payload, response.status)
    const item = record(payload)
    return {
      id: text(item.id),
      bytes: Number(item.bytes),
      files: Number(item.files),
      warnings: Array.isArray(item.warnings) ? item.warnings.map(text) : [],
    }
  }

  async downloadBackup(): Promise<Blob> {
    const response = await this.fetch('/internal/v1/storage/backup', { method: 'POST' })
    if (!response.ok)
      throw decodeError(await response.json().catch(() => undefined), response.status)
    return response.blob()
  }

  async downloadDiagnosticBundle(): Promise<Blob> {
    const response = await this.fetch('/internal/v1/runtime/diagnostics/bundle')
    if (!response.ok)
      throw decodeError(await response.json().catch(() => undefined), response.status)
    return response.blob()
  }

  async downloadAttachment(id: string, signal?: AbortSignal): Promise<Blob> {
    const response = await this.fetch(`/internal/v1/attachments/${encodeURIComponent(id)}`, {
      signal,
    })
    if (!response.ok)
      throw decodeError(await response.json().catch(() => undefined), response.status)
    return response.blob()
  }

  async subscribe(
    onEvent: (event: RuntimeEvent) => void,
    signal: AbortSignal,
    after = 0,
  ): Promise<void> {
    const response = await this.fetch(`/internal/v1/events?after=${after}`, { signal })
    if (!response.ok || !response.body) throw new Error('无法连接 Runtime 事件流')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = new RuntimeEventStreamParser()
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read()
        if (done) return
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          onEvent(event)
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  async subscribeCoding(
    onEvent: (event: CodingEvent) => void,
    signal: AbortSignal,
    after = 0,
  ): Promise<void> {
    const response = await this.fetch(`/internal/v1/coding/events?after_seq=${after}`, { signal })
    if (!response.ok || !response.body) throw new Error('无法连接 Coding 事件流')
    const reader = response.body.getReader(),
      decoder = new TextDecoder()
    let buffer = ''
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read()
        if (done) return
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
        if (buffer.length > 1048576) throw new Error('Coding 事件帧过大')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (data) onEvent(decodeCodingEvent(JSON.parse(data) as unknown))
          boundary = buffer.indexOf('\n\n')
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetch(path, init)
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      throw decodeError(payload, response.status)
    }
    return payload
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      const response = await fetch(`${this.connection.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.connection.token}`,
          ...init.headers,
        },
      })
      if (response.status === 401) this.options.onConnectionInvalid?.()
      return response
    } catch (error) {
      if (!init.signal?.aborted) this.options.onConnectionInvalid?.()
      throw error
    }
  }
}
