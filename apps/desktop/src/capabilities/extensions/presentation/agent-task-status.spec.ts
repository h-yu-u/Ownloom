import { describe, expect, it } from 'vitest'
import type { CodingRun } from '@mlx-studio/api-client'
import { agentTaskStatus } from './agent-task-status'
const run: CodingRun = {
  id: 'r',
  sessionId: 's',
  submissionId: 'sub',
  text: 'task',
  modelId: 'm',
  mode: 'develop',
  status: 'failed',
  phase: '',
  verification: 'not_run',
  error: 'MODEL_REQUEST_TIMEOUT',
  createdAt: '',
  baseline: '',
  fingerprint: null,
  maxRepairRounds: 2,
}
describe('Agent terminal summaries', () => {
  it('does not depend on event presence and does not mislabel cancellation or disconnect', () => {
    expect(agentTaskStatus(run, false)).toMatchObject({
      phase: 'failed',
      error: { message: expect.any(String) },
      canCancel: false,
    })
    expect(agentTaskStatus({ ...run, status: 'cancelled', error: null }, false)).toMatchObject({
      phase: 'cancelled',
      canCancel: false,
    })
    expect(agentTaskStatus({ ...run, status: 'interrupted' }, false).phase).toBe('interrupted')
    expect(agentTaskStatus({ ...run, status: 'running', error: null }, false, true)).toMatchObject({
      phase: 'running',
      connection: 'disconnected',
    })
    expect(agentTaskStatus({ ...run, status: 'cancelling' }, false).canCancel).toBe(false)
  })
})
