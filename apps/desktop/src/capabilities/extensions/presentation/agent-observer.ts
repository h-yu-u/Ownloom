import {
  decodeCodingProjection,
  type AgentChatSnapshot,
  type CodingEvent,
} from '@mlx-studio/api-client'

export function projectAgentEvent(
  snapshot: AgentChatSnapshot,
  event: CodingEvent,
): AgentChatSnapshot {
  if (event.seq <= (snapshot.watermark ?? 0)) return snapshot
  const next = { ...snapshot, watermark: event.seq }
  if (event.sessionId !== snapshot.session.id) return next
  next.events = [...snapshot.events, event].slice(-300)
  const projection = decodeCodingProjection(event.data)
  if (projection?.kind === 'run') {
    const run = projection.value
    next.runs = [...snapshot.runs.filter((item) => item.id !== run.id), run].slice(-50)
  }
  if (projection?.kind === 'approval') {
    const approval = projection.value
    next.approvals = [
      ...snapshot.approvals.filter((item) => item.id !== approval.id),
      approval,
    ].slice(-50)
  }
  return next
}
