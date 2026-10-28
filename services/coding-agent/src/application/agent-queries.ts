import type { AgentQueryRepository } from './repository-ports.js'
import { string } from '../domain/types.js'
import { taskSummaries } from './task-summaries.js'

export function agentQuery(
  repo: AgentQueryRepository,
  method: string,
  p: Record<string, unknown>,
): { value: unknown } | undefined {
  switch (method) {
    case 'agent.sessions.list':
      return {
        value: repo.list('agentSession').map(({ id, title, piPath }) => ({ id, title, piPath })),
      }
    case 'agent.sessions.snapshot': {
      const id = string(p.id),
        { title, piPath } = repo.get('agentSession', id)
      return {
        value: {
          session: { id, title, piPath },
          runs: repo.listRuns(id),
          approvals: repo.listApprovals(id),
          events: repo.events(0, id),
          watermark: repo.watermark(),
        },
      }
    }
    case 'agent.runs.find':
      return { value: repo.findSubmission(string(p.sessionId), string(p.submissionId)) ?? null }
    case 'agent.tasks.list':
      return {
        value: taskSummaries(repo, 'agent'),
      }
    case 'agent.events.wait':
      return { value: repo.waitEvents(typeof p.after === 'number' ? p.after : 0) }
    case 'agent.events.list':
      return {
        value: {
          events: repo.historyEvents(
            typeof p.before === 'number' ? p.before : Number.MAX_SAFE_INTEGER,
            string(p.id),
            typeof p.limit === 'number' ? p.limit : 50,
          ),
          watermark: repo.watermark(),
        },
      }
    default:
      return undefined
  }
}
