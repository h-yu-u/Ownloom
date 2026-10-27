import type { PiSession, RepositoryPort } from './ports.js'
import type { Run } from '../domain/types.js'

export function subscribeRun(
  pi: PiSession,
  repo: RepositoryPort,
  runId: string,
  update: (patch: Partial<Run>) => void,
): void {
  pi.subscribe((event) => {
    const run = repo.get('run', runId)
    if (event.type === 'assistant.delta' && !['starting', 'running'].includes(run.status)) return
    if (event.type === 'assistant.delta' && run.status === 'running' && run.phase !== 'generating')
      update({ phase: 'generating' })
    repo.append(run.sessionId, runId, event.type, event.text, event.data)
  })
}
