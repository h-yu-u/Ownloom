import { describe, expect, it } from 'vitest'
import type { CodingEvent, CodingRun, CodingSnapshot } from '../application/ports'
import { decodeCodingProjection } from '@mlx-studio/api-client'
import { projectCodingEvent } from './event-projection'
const run: CodingRun = {
  id: 'r',
  sessionId: 's',
  submissionId: 'request',
  text: 'task',
  modelId: 'm',
  mode: 'develop',
  status: 'running',
  phase: 'exploring',
  verification: 'not_run',
  error: null,
  createdAt: '',
  baseline: '',
  fingerprint: null,
  maxRepairRounds: 2,
}
const snapshot: CodingSnapshot = {
  session: { id: 's', projectId: 'p', title: 'test', pinned: false, archived: false, piPath: null },
  project: {
    id: 'p',
    path: '/p',
    name: 'p',
    git: false,
    branch: '',
    dirty: '',
    instructions: '',
    commands: [],
  },
  runs: [run],
  activeRun: run,
  approvals: [],
  verifications: [],
  events: [],
  watermark: 10,
}
const event: CodingEvent = {
  seq: 11,
  sessionId: 's',
  runId: 'r',
  type: 'run.updated',
  text: '',
  data: null,
}
describe('committed Coding projection', () => {
  it('updates a run and terminal activity without mutating the previous snapshot', () => {
    const finished = { ...run, status: 'completed' as const }
    const next = projectCodingEvent(snapshot, event, { kind: 'run', value: finished })
    expect(next?.runs).toEqual([finished])
    expect(next?.activeRun).toBeNull()
    expect(snapshot.activeRun?.status).toBe('running')
    expect(snapshot.watermark).toBe(10)
  })
  it('keeps other-session history out while updating the global active run', () => {
    const other = { ...run, id: 'other', sessionId: 'other' }
    const next = projectCodingEvent(
      snapshot,
      { ...event, sessionId: 'other' },
      { kind: 'run', value: other },
    )
    expect(next?.runs).toEqual(snapshot.runs)
    expect(next?.events).toEqual([])
    expect(next?.activeRun?.id).toBe('other')
  })
  it('requires a snapshot for unknown run projections and protocol generations', () => {
    expect(projectCodingEvent(snapshot, event, null)).toBeNull()
    expect(() => decodeCodingProjection({ version: 2, kind: 'run', value: run })).toThrow()
  })
})
