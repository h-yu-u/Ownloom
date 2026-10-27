import { record, number, malformed } from './decoders'
import { decodeRun, decodeApproval, decodeVerification } from './coding-decoders'
import type { CodingRun, CodingApproval, CodingVerification } from './coding-decoders'
export type CodingProjection =
  | { kind: 'run'; value: CodingRun }
  | { kind: 'approval'; value: CodingApproval }
  | { kind: 'verification'; value: CodingVerification }
  | { kind: 'change' }
export function decodeCodingProjection(raw: unknown): CodingProjection | null {
  if (!raw || typeof raw !== 'object' || !('version' in raw)) return null
  const data = record(raw)
  if (number(data.version) !== 1) throw malformed()
  const kind = data.kind
  if (!['run', 'approval', 'verification', 'change'].includes(String(kind))) return null
  if (kind === 'change') return { kind }
  if (kind === 'run') return { kind, value: decodeRun(data.value) }
  if (kind === 'approval') return { kind, value: decodeApproval(data.value) }
  return { kind: 'verification', value: decodeVerification(data.value) }
}
