import { rpcSchema } from '../protocol/generated/schema.js'
const limits = rpcSchema.$defs.CodingSettings.properties
export interface Settings {
  id: string
  defaultModelId: string
  contextBudget: number
  maxRepairRounds: number
}
export const defaultSettings: Settings = {
  id: 'coding',
  defaultModelId: '',
  contextBudget: 1048576,
  maxRepairRounds: 2,
}
export function validateSettings(value: Record<string, unknown>): Settings {
  const { defaultModelId, contextBudget, maxRepairRounds } = value
  if (
    typeof defaultModelId !== 'string' ||
    defaultModelId.length > 128 ||
    typeof contextBudget !== 'number' ||
    !Number.isInteger(contextBudget) ||
    contextBudget < 4096 ||
    contextBudget > limits.contextBudget.maximum ||
    typeof maxRepairRounds !== 'number' ||
    !Number.isInteger(maxRepairRounds) ||
    maxRepairRounds < 0 ||
    maxRepairRounds > limits.maxRepairRounds.maximum
  )
    throw new Error('INVALID_SETTINGS')
  return { id: 'coding', defaultModelId, contextBudget, maxRepairRounds }
}
