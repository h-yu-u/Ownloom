import type { CodingEvent, CodingSnapshot } from '../application/ports'
import { activeStatus } from '../domain/status'
import type { CodingProjection } from '@mlx-studio/api-client'
import { appendTimelineEvent } from './coding-activity'

function upsert<T extends { id: string }>(items: T[], value: T, limit: number): T[] {
  return (
    items.some((item) => item.id === value.id)
      ? items.map((item) => (item.id === value.id ? value : item))
      : [...items, value]
  ).slice(-limit)
}
/** Pure projection of a committed event; sequence recovery belongs to the observer. */
export function projectCodingEvent(
  snapshot: CodingSnapshot,
  event: CodingEvent,
  projection: CodingProjection | null,
): CodingSnapshot | null {
  if (!projection && /^(run\.|approval\.|verification\.)/.test(event.type)) return null
  const sameSession = event.sessionId === snapshot.session.id
  const next = {
    ...snapshot,
    watermark: event.seq,
    events: sameSession ? appendTimelineEvent(snapshot.events, event) : snapshot.events,
  }
  if (projection?.kind === 'run') {
    const run = projection.value
    next.activeRun = activeStatus(run.status)
      ? run
      : snapshot.activeRun?.id === run.id
        ? null
        : snapshot.activeRun
    if (sameSession) next.runs = upsert(snapshot.runs, run, 50)
  }
  if (sameSession && projection?.kind === 'approval')
    next.approvals = upsert(snapshot.approvals, projection.value, 50)
  if (sameSession && projection?.kind === 'verification')
    next.verifications = upsert(snapshot.verifications, projection.value, 20)
  return next
}
