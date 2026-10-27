import { createHash } from 'node:crypto'
import { canonical, type Snapshot, type Tool } from '../extensions/domain/types.js'

export function approvalBinding(tool: Tool, args: Record<string, unknown>, snapshot?: Snapshot) {
  return {
    toolId: tool.id,
    schemaDigest: tool.schemaDigest,
    args,
    argsDigest: createHash('sha256').update(canonical(args)).digest('hex'),
    capabilitySnapshotDigest: snapshot?.snapshotDigest ?? null,
    catalogRevision: snapshot?.catalogRevision ?? null,
    policyEpoch: snapshot?.policyEpoch ?? null,
  }
}
