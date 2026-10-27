import type { Snapshot, Selection } from '../extensions/domain/types.js'
import type { Settings } from './settings.js'
export type Mode = 'analyze' | 'develop' | 'review'
export type PermissionMode = 'ask' | 'full'
export type Status =
  | 'queued'
  | 'starting'
  | 'running'
  | 'awaiting_approval'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
export interface Project {
  id: string
  path: string
  name: string
  git: boolean
  branch: string
  dirty: string
  instructions: string
  commands: string[]
}
export interface Session {
  id: string
  projectId: string
  title: string
  titleSource?: 'input' | 'manual'
  pinned: boolean
  archived: boolean
  transcript?: TranscriptDescriptor
  piPath: string | null
}
export interface VerificationPlan {
  digest: string
  commands: string[]
  cwd: string
  manifestDigest: string
  repairLimit: number
  timeoutMs: number
  scope: string
  invalid?: boolean
}
export interface Run {
  probe?: boolean
  verifyOnly?: boolean
  permissionMode?: PermissionMode
  initialPermissionMode?: PermissionMode
  verifyAfter?: boolean
  handoff?: Record<string, unknown>
  verificationPlan?: VerificationPlan
  capabilitySnapshot?: Snapshot
  selection?: Selection
  id: string
  sessionId: string
  submissionId: string
  text: string
  modelId: string
  mode: Mode
  status: Status
  phase: string
  verification: 'not_run' | 'running' | 'passed' | 'failed' | 'partial'
  error: string | null
  createdAt: string
  baseline: string
  fingerprint: string | null
  verificationCommands?: string[]
  maxRepairRounds: number
}
export interface Approval {
  id: string
  runId: string
  sessionId: string
  toolCallId: string
  action: 'command' | 'file_write' | 'mcp'
  parameters: Record<string, unknown>
  command: string
  cwd: string
  policyVersion: 1
  expiresAt: number
  status: 'pending' | 'allowed' | 'denied'
}
export interface Change {
  id: string
  runId: string
  sessionId: string
  path: string
  before: string | null
  after: string
  restored: boolean
  state: 'pending' | 'written'
}
export interface Verification {
  planDigest?: string
  purpose?: 'command' | 'verification'
  id: string
  runId: string
  sessionId: string
  command: string
  exitCode: number | null
  output: string
  truncated: boolean
  fingerprint: string
  stale: boolean
}
export interface Event {
  seq: number
  sessionId: string
  runId: string | null
  type: string
  text: string
  data: unknown
}
export interface Capability {
  id: string
  status: 'verified' | 'unverified'
  verifiedAt: string | null
  engineVersion: string
  parserVersion: string
  modelFingerprint: string
  detail: string
}
export interface AgentSession {
  id: string
  title: string
  transcript?: TranscriptDescriptor
  piPath: string | null
}
export interface Entities {
  instructions: { id: string; path: string; digest: string; content: string; scope: string }
  agentSession: AgentSession
  settings: Settings
  project: Project
  session: Session
  run: Run
  approval: Approval
  change: Change
  verification: Verification
  capability: Capability
}
export const terminal = (status: Status): boolean =>
  ['completed', 'failed', 'cancelled', 'interrupted'].includes(status)
export function nextStatus(current: Status, next: Status): Status {
  if (current === next) return current
  if (terminal(current)) throw new Error('RUN_ALREADY_FINISHED')
  if (current === 'cancelling' && next !== 'cancelled' && next !== 'interrupted')
    throw new Error('RUN_CANCELLING')
  return next
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PARAMS')
  return value as Record<string, unknown>
}
export function string(value: unknown, max = 8192): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    throw new Error('INVALID_PARAMS')
  return value
}
export function mode(value: unknown): Mode {
  if (value !== 'analyze' && value !== 'develop' && value !== 'review')
    throw new Error('INVALID_MODE')
  return value
}

export interface TranscriptDescriptor {
  sourceCwd?: string
  restoredCwd?: string
  productSessionId: string
  piSessionId: string
  path: string
  state: 'allocated' | 'materialized'
  lastKnownEntryId: string | null
}
