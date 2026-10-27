import { randomUUID } from 'node:crypto'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { PiSession } from '../application/ports.js'
import type { Snapshot } from '../extensions/domain/types.js'
import { providerErrorCode } from '../application/model-result.js'
import { toolEvidence } from './extensions/tool-evidence.js'

export function createPiEventBridge(
  callback: Parameters<PiSession['subscribe']>[0],
  snapshot?: Snapshot,
  live = true,
): (event: AgentSessionEvent) => void {
  let messageId = randomUUID(),
    emittedAt = 0
  return (event) => {
    if (event.type === 'compaction_start' || event.type === 'compaction_end')
      callback({ type: event.type, text: '', data: event })
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      messageId = randomUUID()
      emittedAt = 0
    }
    if (
      live &&
      event.type === 'message_update' &&
      event.message.role === 'assistant' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      const now = Date.now()
      if (emittedAt && now - emittedAt < 80) return
      emittedAt = now
      callback({
        type: 'assistant.delta',
        text: event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        data: { messageId, streaming: true },
      })
    }
    if (event.type === 'message_end' && event.message.role === 'assistant')
      callback({
        type: 'assistant.message',
        text: event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        data: {
          messageId,
          streaming: false,
          stopReason: event.message.stopReason,
          error: providerErrorCode(event.message.errorMessage) ?? null,
        },
      })
    if (event.type === 'tool_execution_end') toolFinished(event, callback, snapshot)
  }
}

function toolFinished(
  event: Extract<AgentSessionEvent, { type: 'tool_execution_end' }>,
  callback: Parameters<PiSession['subscribe']>[0],
  snapshot?: Snapshot,
): void {
  callback({
    type: 'tool.finished',
    text: event.toolName,
    data: {
      toolCallId: event.toolCallId,
      capabilitySnapshotDigest: snapshot?.snapshotDigest,
      toolId: snapshot?.tools.find((tool) => tool.modelName === event.toolName)?.id,
      schemaDigest: snapshot?.tools.find((tool) => tool.modelName === event.toolName)?.schemaDigest,
      ...toolEvidence(event.result),
      isError: event.isError,
      result: previewResult(event.result),
    },
  })
}

function previewResult(value: unknown): { preview: string; truncated: boolean } {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  return { preview: bytes.subarray(0, 4096).toString('utf8'), truncated: bytes.length > 4096 }
}
