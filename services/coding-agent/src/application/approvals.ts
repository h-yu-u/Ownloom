import { randomUUID } from 'node:crypto'
import type { Approval, PermissionMode, Run } from '../domain/types.js'
import { terminal } from '../domain/types.js'
import type { RepositoryPort } from './ports.js'
export class Approvals {
  private pending = new Map<string, (allowed: boolean) => void>()
  constructor(private repo: Pick<RepositoryPort, 'get' | 'save' | 'pendingApprovals'>) {}
  async request(
    input: Omit<Approval, 'id' | 'expiresAt' | 'status' | 'policyVersion'>,
    signal: AbortSignal,
    trusted = false,
  ): Promise<boolean> {
    if (signal.aborted) throw new Error('CANCELLED')
    const approval: Approval = {
      ...input,
      id: randomUUID(),
      expiresAt: Date.now() + 300000,
      status: 'pending',
      policyVersion: 1,
    }
    if (trusted) {
      this.repo.save(
        'approval',
        { ...approval, status: 'allowed' },
        'approval.resolved',
        input.command,
      )
      return true
    }
    this.repo.save('approval', approval, 'approval.requested', input.command)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.resolve(approval.id, false), 300000)
      const stop = (): void => this.resolve(approval.id, false)
      this.pending.set(approval.id, (allowed) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', stop)
        resolve(allowed)
      })
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) this.resolve(approval.id, false)
    })
  }
  resolve(id: string, allowed: boolean): void {
    const approval = this.repo.get('approval', id)
    if (approval.status !== 'pending') throw new Error('APPROVAL_ALREADY_RESOLVED')
    const valid =
      approval.expiresAt > Date.now() && !terminal(this.repo.get('run', approval.runId).status)
    this.repo.save(
      'approval',
      { ...approval, status: allowed && valid ? 'allowed' : 'denied' },
      'approval.resolved',
    )
    this.pending.get(id)?.(allowed && valid)
    this.pending.delete(id)
  }
  denyRun(runId: string): void {
    for (const approval of this.repo.pendingApprovals(runId))
      if (approval.runId === runId && approval.status === 'pending')
        this.resolve(approval.id, false)
  }
  setPermissions(id: string, permissionMode: PermissionMode): Run {
    const run = this.repo.get('run', id)
    if (terminal(run.status) || run.status === 'cancelling') throw new Error('RUN_NOT_READY')
    if (permissionMode === 'full' && run.mode !== 'develop') throw new Error('READ_ONLY_MODE')
    const updated = this.repo.save(
      'run',
      {
        ...run,
        permissionMode,
        initialPermissionMode: run.initialPermissionMode ?? run.permissionMode ?? 'ask',
      },
      'run.updated',
    )
    if (permissionMode === 'full')
      for (const approval of this.repo.pendingApprovals(id)) this.resolve(approval.id, true)
    return updated
  }
}
