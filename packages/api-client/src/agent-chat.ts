import type { Transport } from './transport/ports'
import type { components } from './generated-schema'
import { record, text, list, nullableText, number } from './decoders'
import { decodeRun, decodeApproval, decodeCodingEvent } from './coding-decoders'
export type AgentSession = components['schemas']['AgentSessionView']
export type AgentChatSnapshot = components['schemas']['AgentChatSnapshot']
export type AgentChatRequest = components['schemas']['AgentChatRunRequest']
function session(value: unknown): AgentSession {
  const v = record(value)
  return { id: text(v.id), title: text(v.title), piPath: nullableText(v.piPath) }
}
function snapshot(value: unknown): AgentChatSnapshot {
  const v = record(value)
  return {
    watermark: typeof v.watermark === 'number' ? v.watermark : 0,
    session: session(v.session),
    runs: list(v.runs, decodeRun),
    approvals: list(v.approvals, decodeApproval),
    events: list(v.events, decodeCodingEvent),
  }
}
export function agentChatEndpoints(transport: Pick<Transport, 'get' | 'post'>) {
  const root = '/internal/v1/agent-chat',
    id = encodeURIComponent
  return {
    events: async (after: number, signal?: AbortSignal) => {
      const batch = record(await transport.get(`${root}/events/poll?after=${after}`, signal))
      return { events: list(batch.events, decodeCodingEvent), watermark: number(batch.watermark) }
    },
    sessions: async () => list(await transport.get(`${root}/sessions`), session),
    create: async (title = '工具助手') =>
      session(await transport.post(`${root}/sessions`, { title })),
    snapshot: async (key: string) => snapshot(await transport.get(`${root}/sessions/${id(key)}`)),
    submit: async (key: string, body: AgentChatRequest) =>
      decodeRun(await transport.post(`${root}/sessions/${id(key)}/runs`, body)),
    cancel: async (key: string) =>
      decodeRun(await transport.post(`${root}/runs/${id(key)}/cancel`)),
    resolve: (key: string, allowed: boolean) =>
      transport.post(`${root}/approvals/${id(key)}/resolve`, { allowed }),
  }
}
