import type { Run, Verification } from './types.js'

/** Only the frozen explicit plan can produce a verification result. */
export function verificationStatus(
  run: Run,
  checks: readonly Verification[],
  fingerprint: string,
): Run['verification'] {
  if (run.verificationPlan?.invalid) return 'partial'
  const commands = run.verificationCommands ?? []
  if (fingerprint.startsWith('partial:') || !fingerprint) return 'partial'
  if (!commands.length) return 'not_run'
  const attempts = checks.filter(
    (check) => check.purpose === 'verification' && check.runId === run.id,
  )
  if (!attempts.length) return 'not_run'
  const latest = commands.map((command) => attempts.findLast((check) => check.command === command))
  if (
    latest.some(
      (check) =>
        !check ||
        check.stale ||
        check.fingerprint !== fingerprint ||
        (run.verificationPlan && check.planDigest !== run.verificationPlan.digest),
    )
  )
    return 'partial'
  return latest.every((check) => check?.exitCode === 0) ? 'passed' : 'failed'
}

export function completedRunPatch(
  run: Run,
  checks: readonly Verification[],
  fingerprint: string,
): Partial<Run> {
  return {
    status: 'completed',
    phase: 'reviewing',
    verification: verificationStatus(run, checks, fingerprint),
    fingerprint,
  }
}
