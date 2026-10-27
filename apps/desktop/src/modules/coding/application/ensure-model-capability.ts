import type { CodingCapability, CodingGateway } from './ports'
interface Dependencies {
  gateway: Pick<CodingGateway, 'verifyModel'>
  capabilities(): readonly CodingCapability[]
  update(value: CodingCapability): void
  preparing(value: boolean): void
}
export async function ensureModelCapability(
  id: string,
  deps: Dependencies,
  force = false,
): Promise<void> {
  if (!force && deps.capabilities().some((item) => item.id === id && item.status === 'verified'))
    return
  deps.preparing(true)
  try {
    const result = await deps.gateway.verifyModel(id)
    deps.update(result)
    if (result.status !== 'verified') throw new Error(result.detail)
  } finally {
    deps.preparing(false)
  }
}
