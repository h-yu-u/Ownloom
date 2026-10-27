import type { RepositoryPort } from './ports.js'
import type { RpcResultMap } from '../protocol/generated/types.js'

export function taskSummaries(
  repo: RepositoryPort,
  owner: 'coding' | 'agent',
): RpcResultMap['tasks.list'] {
  return repo.recentRuns().map((run) => {
    const session =
      owner === 'coding'
        ? repo.find('session', run.sessionId)
        : repo.find('agentSession', run.sessionId)
    const projectId =
      session && 'projectId' in session && typeof session.projectId === 'string'
        ? session.projectId
        : undefined
    const createdAt = Date.parse(run.createdAt)
    return {
      owner,
      id: run.id,
      sessionId: run.sessionId,
      title: session?.title?.trim() || (owner === 'coding' ? '未命名代码会话' : '未命名工具会话'),
      kind: owner,
      groupId: `${owner}:${run.sessionId}`,
      createdAt: Number.isFinite(createdAt) ? createdAt : null,
      phase: run.phase,
      state: run.status,
      needsApproval: run.status === 'awaiting_approval',
      errorCode: run.error,
      target:
        owner === 'agent'
          ? `/agent-chat?sessionId=${encodeURIComponent(run.sessionId)}`
          : projectId
            ? `/coding/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(run.sessionId)}`
            : '/coding',
    }
  })
}
