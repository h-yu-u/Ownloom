/** Only managed artifact metadata is projected; tool text stays in the bounded preview. */
export function toolEvidence(value: unknown): {
  childJobId?: string
  artifactRefs?: { kind: 'image' | 'audio'; id: string }[]
} {
  if (!value || typeof value !== 'object' || !('details' in value)) return {}
  const details = value.details
  if (!details || typeof details !== 'object') return {}
  const childJobId =
    'childJobId' in details && typeof details.childJobId === 'string'
      ? details.childJobId
      : undefined
  const raw =
    'artifactRefs' in details && Array.isArray(details.artifactRefs) ? details.artifactRefs : []
  const artifactRefs = raw
    .slice(0, 8)
    .flatMap((item: unknown): { kind: 'image' | 'audio'; id: string }[] => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('kind' in item) ||
        !('id' in item) ||
        typeof item.id !== 'string'
      )
        return []
      return item.kind === 'image' || item.kind === 'audio'
        ? [{ kind: item.kind, id: item.id }]
        : []
    })
  return { ...(childJobId ? { childJobId } : {}), ...(artifactRefs.length ? { artifactRefs } : {}) }
}
