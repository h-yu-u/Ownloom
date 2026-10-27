import { verificationStatus } from '../domain/verification.js'
import type { RepositoryPort } from './ports.js'
export async function buildSnapshot(
  repo: RepositoryPort,
  fingerprint: (root: string) => Promise<string>,
  id: string,
) {
  const session = repo.get('session', id)
  const project = repo.get('project', session.projectId)
  const version = repo.active() ? null : await fingerprint(project.path)
  const checks = repo
    .listChecks(session.id)
    .map((item) => ({ ...item, stale: item.stale || item.fingerprint !== version }))
  return {
    session,
    project,
    runs: repo.listRuns(session.id).map((run) => ({
      ...run,
      verification:
        run.verification === 'not_run'
          ? ('not_run' as const)
          : verificationStatus(run, repo.checksForRun(run.id), version ?? ''),
    })),
    approvals: repo
      .listApprovals(session.id)
      .map((item) => (item.status === 'pending' ? item : { ...item, parameters: {} })),
    verifications: checks.slice(-20),
    events: repo.historyEvents(repo.watermark() + 1, session.id, 100),
    watermark: repo.watermark(),
    activeRun: repo.active() ?? null,
  }
}
