import type { PiSession, RepositoryPort, RunPorts } from './ports.js'
import { completedRunPatch } from '../domain/verification.js'
import type { Run, Project } from '../domain/types.js'
import { randomUUID } from 'node:crypto'
import { checkModel } from './model-result.js'
export async function promptAndVerify(input: {
  pi: PiSession
  run: Run
  project: Project
  abort: AbortController
  probe: boolean
  verifyOnly: boolean
  command(
    callId: string,
    command: string,
    signal: AbortSignal,
    probe: boolean,
  ): Promise<{ exitCode: number | null }>
  checks(): unknown
}): Promise<void> {
  const { pi, run, abort, probe, verifyOnly } = input
  const commands = run.verificationCommands ?? []
  if (!verifyOnly) {
    await pi.prompt(run.text)
    checkModel(pi)
  }
  for (
    let repair = 0;
    !abort.signal.aborted && commands.length && run.mode === 'develop';
    repair++
  ) {
    let passed = true
    for (const command of commands) {
      let result
      try {
        result = await input.command(`verify-${randomUUID()}`, command, abort.signal, probe)
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'VERIFICATION_PLAN_CHANGED' ||
            (error.message === 'APPROVAL_DENIED' && !verifyOnly))
        )
          return
        throw error
      }
      if (result.exitCode !== 0) passed = false
    }
    if (passed || repair >= run.maxRepairRounds || verifyOnly) break
    await pi.prompt(
      'Project verification failed. Repair without changing tests or verification configuration. Evidence:\n' +
        JSON.stringify(input.checks()),
    )
  }
  if (abort.signal.aborted) throw new Error('CANCELLED')
  if (!verifyOnly) checkModel(pi)
}

export async function finalizeRun(input: {
  repo: RepositoryPort
  ports: RunPorts
  run: Run
  root: string
}): Promise<Partial<Run>> {
  const fingerprint = await input.ports.fingerprint(input.root)
  return completedRunPatch(
    input.repo.get('run', input.run.id),
    input.repo.checksForRun(input.run.id),
    fingerprint,
  )
}
