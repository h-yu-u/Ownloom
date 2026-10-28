import { nextStatus, type Run } from '../domain/types.js'
import type { RepositoryPort } from './ports.js'

/** Shared by Coding and Agent Chat; only a Host restart creates a healthy owner. */
export class RunAdmission {
  private faulted = false
  get blocked(): boolean {
    return this.faulted
  }
  check(): void {
    if (this.faulted) throw new Error('CODING_CLEANUP_FAILED')
  }
  block(): void {
    this.faulted = true
  }
}

/** Attempt every cleanup before publishing a terminal result or releasing ownership. */
export async function settleRun(input: {
  repo: RepositoryPort
  id: string
  outcome: Partial<Run>
  signal: AbortSignal
  cleanup: (() => void | Promise<void>)[]
}): Promise<void> {
  let failed = false
  for (const cleanup of input.cleanup) {
    try {
      await cleanup()
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error('CODING_CLEANUP_FAILED')
  const run = input.repo.get('run', input.id)
  const outcome: Partial<Run> =
    input.signal.aborted || run.status === 'cancelling'
      ? { status: 'cancelled', error: 'CANCELLED' }
      : input.outcome
  input.repo.save(
    'run',
    {
      ...run,
      ...outcome,
      status: nextStatus(run.status, outcome.status ?? 'failed'),
    },
    'run.updated',
  )
}

/** Final background-task boundary: persistence failure must also leave admission closed. */
export function failRun(repo: RepositoryPort, id: string, admission: RunAdmission): void {
  admission.block()
  try {
    const run = repo.get('run', id)
    repo.save(
      'run',
      {
        ...run,
        status: 'interrupted',
        phase: 'cleanup_failed',
        error: 'CODING_CLEANUP_FAILED',
      },
      'run.cleanup_failed',
      'CODING_CLEANUP_FAILED',
    )
  } catch {
    // A broken repository cannot record the fault; the shared admission error remains visible.
  }
}
