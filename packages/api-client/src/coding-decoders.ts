import { decodeExtensionSnapshot, decodeSelection } from './extension-decoders'
import type { components } from './generated-schema'
import { record, text, number, list, nullableText, malformed } from './decoders'
type Schema = components['schemas']
export type CodingSettings = Schema['CodingSettings']
export type CodingProject = Schema['CodingProjectView']
export type CodingSession = Schema['CodingSessionView']
export type CodingRun = Schema['CodingRunView']
export type CodingSnapshot = Schema['CodingSnapshot']
export type CodingApproval = Schema['CodingApprovalView']
export type CodingVerification = Schema['CodingVerificationView']
export type CodingChange = Schema['CodingChangeView']
export type CodingEvent = Schema['CodingEventView']
export type CodingCapability = Schema['CodingCapability']
export type CodingChanges = Schema['CodingChanges']
export type CodingRunRequest = Schema['CodingRunRequest']
export type CodingSessionPatch = Schema['CodingSessionPatch']
const bool = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw malformed()
  return value
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  for (const candidate of values) if (candidate === value) return candidate
  throw malformed()
}
export function decodeProject(value: unknown): CodingProject {
  const p = record(value)
  return {
    id: text(p.id),
    path: text(p.path),
    name: text(p.name),
    git: bool(p.git),
    branch: text(p.branch),
    dirty: text(p.dirty),
    instructions: text(p.instructions),
    commands: list(p.commands, text),
  }
}
export function decodeSession(value: unknown): CodingSession {
  const p = record(value)
  return {
    id: text(p.id),
    projectId: text(p.projectId),
    title: text(p.title),
    pinned: bool(p.pinned),
    archived: bool(p.archived),
    piPath: nullableText(p.piPath),
  }
}
function decodePlan(value: unknown): NonNullable<CodingRun['verificationPlan']> {
  const p = record(value)
  return {
    digest: text(p.digest),
    commands: list(p.commands, text),
    cwd: text(p.cwd),
    manifestDigest: text(p.manifestDigest),
    repairLimit: number(p.repairLimit),
    timeoutMs: number(p.timeoutMs),
    scope: text(p.scope),
    invalid: p.invalid === true,
  }
}
export function decodeRun(value: unknown): CodingRun {
  const p = record(value)
  return {
    id: text(p.id),
    sessionId: text(p.sessionId),
    submissionId: text(p.submissionId),
    text: text(p.text),
    modelId: text(p.modelId),
    mode: choice(p.mode, ['analyze', 'develop', 'review']),
    permissionMode:
      p.permissionMode == null ? 'ask' : choice(p.permissionMode, ['ask', 'full'] as const),
    status: choice(p.status, [
      'queued',
      'starting',
      'running',
      'awaiting_approval',
      'cancelling',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
    ]),
    phase: text(p.phase),
    verification: choice(p.verification, ['not_run', 'running', 'passed', 'failed', 'partial']),
    error: nullableText(p.error),
    createdAt: text(p.createdAt),
    baseline: text(p.baseline),
    fingerprint: nullableText(p.fingerprint),
    maxRepairRounds: number(p.maxRepairRounds),
    ...(p.verificationPlan ? { verificationPlan: decodePlan(p.verificationPlan) } : {}),
    ...(p.capabilitySnapshot
      ? { capabilitySnapshot: decodeExtensionSnapshot(p.capabilitySnapshot) }
      : {}),
    ...(p.selection ? { selection: decodeSelection(p.selection) } : {}),
  }
}
export function decodeApproval(value: unknown): CodingApproval {
  const p = record(value)
  if (p.policyVersion !== 1) throw malformed()
  return {
    id: text(p.id),
    runId: text(p.runId),
    sessionId: text(p.sessionId),
    toolCallId: text(p.toolCallId),
    action: choice(p.action, ['command', 'file_write', 'mcp']),
    parameters: record(p.parameters),
    command: text(p.command),
    cwd: text(p.cwd),
    policyVersion: 1,
    expiresAt: number(p.expiresAt),
    status: choice(p.status, ['pending', 'allowed', 'denied']),
  }
}
export function decodeVerification(value: unknown): CodingVerification {
  const p = record(value)
  return {
    planDigest: nullableText(p.planDigest),
    purpose: p.purpose === undefined ? 'command' : choice(p.purpose, ['command', 'verification']),
    id: text(p.id),
    runId: text(p.runId),
    sessionId: text(p.sessionId),
    command: text(p.command),
    exitCode: p.exitCode === null ? null : number(p.exitCode),
    output: text(p.output),
    truncated: bool(p.truncated),
    fingerprint: text(p.fingerprint),
    stale: bool(p.stale),
  }
}
export function decodeChange(value: unknown): CodingChange {
  const p = record(value)
  return {
    id: text(p.id),
    runId: text(p.runId),
    sessionId: text(p.sessionId),
    path: text(p.path),
    before: nullableText(p.before),
    contentLoaded: bool(p.contentLoaded),
    after: text(p.after),
    restored: bool(p.restored),
    state: choice(p.state, ['pending', 'written']),
  }
}
export function decodeCodingEvent(value: unknown): CodingEvent {
  const p = record(value),
    seq = number(p.seq)
  if (!Number.isSafeInteger(seq) || seq < 0) throw malformed()
  return {
    seq,
    sessionId: text(p.sessionId),
    runId: nullableText(p.runId),
    type: text(p.type),
    text: text(p.text),
    data: p.data,
  }
}
export function decodeCapability(value: unknown): CodingCapability {
  const p = record(value)
  return {
    id: text(p.id),
    status: choice(p.status, ['verified', 'unverified']),
    verifiedAt: nullableText(p.verifiedAt),
    engineVersion: text(p.engineVersion),
    parserVersion: text(p.parserVersion),
    modelFingerprint: text(p.modelFingerprint),
    detail: text(p.detail),
  }
}
export function decodeSnapshot(value: unknown): CodingSnapshot {
  const p = record(value)
  return {
    session: decodeSession(p.session),
    project: decodeProject(p.project),
    runs: list(p.runs, decodeRun),
    approvals: list(p.approvals, decodeApproval),
    verifications: list(p.verifications, decodeVerification),
    events: list(p.events, decodeCodingEvent),
    watermark: number(p.watermark),
    activeRun: p.activeRun === null ? null : decodeRun(p.activeRun),
  }
}
export function decodeChanges(value: unknown): CodingChanges {
  const p = record(value)
  return {
    managed: list(p.managed, decodeChange),
    workspace: text(p.workspace),
    diff: text(p.diff),
    scope: text(p.scope),
  }
}

export function decodeCodingSettings(value: unknown): CodingSettings {
  const p = record(value)
  return {
    id: 'coding',
    defaultModelId: text(p.defaultModelId),
    contextBudget: number(p.contextBudget),
    maxRepairRounds: number(p.maxRepairRounds),
    ...(p.verificationPlan ? { verificationPlan: decodePlan(p.verificationPlan) } : {}),
    ...(p.capabilitySnapshot
      ? { capabilitySnapshot: decodeExtensionSnapshot(p.capabilitySnapshot) }
      : {}),
    ...(p.selection ? { selection: decodeSelection(p.selection) } : {}),
  }
}
