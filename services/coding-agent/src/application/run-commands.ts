import { randomUUID } from 'node:crypto'
import { verificationStatus } from '../domain/verification.js'
import type { RunPorts } from './ports.js'
import type { CommandRepository } from './repository-ports.js'
import type { Run } from '../domain/types.js'
import type { Approvals } from './approvals.js'
export class RunCommands {
  constructor(
    private input: {
      repo: CommandRepository
      ports: RunPorts
      approvals: Approvals
      update(id: string, patch: Partial<Run>): void
    },
  ) {}
  async execute(
    id: string,
    callId: string,
    command: string,
    signal: AbortSignal,
    probe: boolean,
    verification = probe,
  ) {
    if (probe && command !== "/usr/bin/grep -qx 'after' probe.txt")
      throw new Error('PROBE_COMMAND_NOT_ALLOWED')
    if (/\bgit\s+(?:[^;&|]*\s)?(?:commit|push|reset|clean|rebase)\b/.test(command))
      throw new Error('GIT_MUTATION_DISABLED')
    const run = this.input.repo.get('run', id),
      session = this.input.repo.get('session', run.sessionId),
      project = this.input.repo.get('project', session.projectId)
    if (run.mode !== 'develop') throw new Error('READ_ONLY_MODE')
    if (signal.aborted) throw new Error('CANCELLED')
    this.input.update(id, {
      status: run.permissionMode === 'full' ? 'running' : 'awaiting_approval',
      phase: verification ? 'verifying' : 'executing',
    })
    const allowed = await this.input.approvals.request(
      {
        runId: id,
        sessionId: session.id,
        toolCallId: callId,
        action: 'command',
        parameters: { command },
        command,
        cwd: project.path,
      },
      signal,
      run.permissionMode === 'full' || (probe && command === "/usr/bin/grep -qx 'after' probe.txt"),
    )
    if (signal.aborted) throw new Error('CANCELLED')
    this.input.update(id, { status: 'running' })
    if (!allowed) throw new Error('APPROVAL_DENIED')
    const plan = run.verificationPlan
    if (
      verification &&
      plan &&
      (await this.input.ports.verificationManifest?.(project.path)) !== plan.manifestDigest
    ) {
      this.input.update(id, {
        verificationPlan: { ...plan, invalid: true },
        verification: 'partial',
      })
      throw new Error('VERIFICATION_PLAN_CHANGED')
    }
    const before = await this.input.ports.fingerprint(project.path)
    this.input.repo.append(session.id, id, 'command.started', command, { toolCallId: callId })
    const result = await this.input.ports.commands.run(command, project.path, signal)
    const after = await this.input.ports.fingerprint(project.path)
    const check = {
      id: randomUUID(),
      purpose: verification ? ('verification' as const) : ('command' as const),
      sessionId: session.id,
      runId: id,
      command,
      ...result,
      planDigest: plan?.digest,
      fingerprint: before,
      stale:
        before !== after ||
        !!(
          verification &&
          plan &&
          (plan.manifestDigest.startsWith('partial:') ||
            (await this.input.ports.verificationManifest?.(project.path)) !== plan.manifestDigest)
        ),
    }
    this.input.repo.save('verification', check, 'verification.finished', result.output)
    this.input.update(id, {
      verification: verificationStatus(run, this.input.repo.checksForRun(id), after),
      fingerprint: before === after ? after : null,
    })
    return result
  }
}
