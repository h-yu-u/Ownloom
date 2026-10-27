export type {
  ExtensionSkill as Skill,
  McpServer as Server,
  McpTransport as Transport,
  McpInventory as Inventory,
  ExtensionTool as Tool,
  ExtensionBinding as Binding,
  ExtensionSelection as Selection,
  ExtensionScope as Scope,
  ExtensionSnapshot as Snapshot,
  ExtensionCatalog as Catalog,
  ExtensionOperation as Operation,
  ExtensionMutation as Mutation,
  ExtensionEvent as Event,
  ExtensionResolution as Resolution,
} from '../../protocol/generated/types.js'
import type { ExtensionScope, ExtensionSelection } from '../../protocol/generated/types.js'
export const emptySelection = (): ExtensionSelection => ({ skillIds: [], toolIds: [] })
export function scopeKey(scope: ExtensionScope): string {
  if (scope.kind === 'workspace' && scope.scopeId !== 'default')
    throw new Error('INVALID_EXTENSION_SCOPE')
  if (scope.kind === 'project' && scope.workspace !== 'coding')
    throw new Error('INVALID_EXTENSION_SCOPE')
  return `${scope.workspace}:${scope.kind}:${scope.scopeId}`
}
export function resourcePath(path: string): boolean {
  return (
    !!path &&
    !path.includes('\0') &&
    !path.includes('\\') &&
    !path.startsWith('/') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..')
  )
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
