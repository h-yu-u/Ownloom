import { contextSettings } from '../../domain/context-budget.js'
import {
  emptySelection,
  scopeKey,
  type Binding,
  type Scope,
  type Selection,
  type Snapshot,
} from '../domain/types.js'
import type { ExtensionPorts } from './ports.js'
export class ResourceResolver {
  constructor(private ports: ExtensionPorts) {}
  selection(scope: Scope, explicit?: Selection): Selection {
    scopeKey(scope)
    let selected =
      this.ports.repo.binding(scopeKey({ ...scope, kind: 'workspace', scopeId: 'default' }))
        ?.selection ?? emptySelection()
    if (scope.kind !== 'workspace')
      selected = this.ports.repo.binding(scopeKey(scope))?.selection ?? selected
    return explicit ?? selected
  }
  resolve(scope: Scope, explicit?: Selection, mode = 'analyze', budget = 32768, agent = false) {
    const { repo, digest } = this.ports,
      catalog = repo.catalog()
    const selection = this.selection(scope, explicit)
    if (
      new Set(selection.skillIds).size !== selection.skillIds.length ||
      new Set(selection.toolIds).size !== selection.toolIds.length
    )
      throw new Error('INVALID_EXTENSION_SELECTION')
    const skills = selection.skillIds.map((id) => {
      const skill = repo.skill(id)
      if (!skill.enabled || !skill.workspaces.includes(scope.workspace))
        throw new Error('SKILL_NOT_AVAILABLE')
      return skill
    })
    const servers = catalog.servers.filter((server) =>
      selection.toolIds.some((id) => id.startsWith(`${server.id}:`)),
    )
    const tools = servers.flatMap((server) => {
      if (!server.enabled) throw new Error('MCP_SERVER_NOT_ALLOWED')
      return repo
        .inventory(server.id, server.revision)
        .tools.filter((tool) => selection.toolIds.includes(tool.id))
        .map((tool) => {
          if (!server.allowedTools.includes(tool.originalName))
            throw new Error('MCP_TOOL_NOT_ALLOWED')
          if (scope.workspace !== 'coding' && !agent) throw new Error('AGENT_CHANNEL_NOT_AVAILABLE')
          if (mode !== 'develop' && tool.risk !== 'read') throw new Error('READ_ONLY_MODE')
          return tool
        })
    })
    const builtins = catalog.builtinTools.filter((tool) => selection.toolIds.includes(tool.id))
    if (builtins.length && (mode !== 'develop' || (scope.workspace !== 'coding' && !agent)))
      throw new Error('READ_ONLY_MODE')
    if (
      builtins.some((tool) => tool.originalName === 'image_generate') &&
      !selection.mediaBindings?.imageModelId
    )
      throw new Error('CAPABILITY_MODEL_REQUIRED')
    if (
      builtins.some((tool) => tool.originalName === 'speech_generate') &&
      (!selection.mediaBindings?.speechModelId || !selection.mediaBindings.speechMode)
    )
      throw new Error('CAPABILITY_MODEL_REQUIRED')
    tools.push(...builtins)
    if (tools.length !== selection.toolIds.length) throw new Error('MCP_TOOL_NOT_ALLOWED')
    const baseTools = scope.workspace === 'coding' ? (mode === 'develop' ? 7 : 4) : 0
    const totalToolCount =
      baseTools + (skills.length && (scope.workspace === 'coding' || agent) ? 1 : 0) + tools.length
    if (totalToolCount > 16) throw new Error('TOOL_BUDGET_EXCEEDED')
    const baseNames =
      scope.workspace === 'coding'
        ? [
            'read',
            'list',
            'search',
            'git_status',
            ...(mode === 'develop' ? ['write', 'edit', 'run_command'] : []),
          ]
        : []
    const available = new Set([
      ...baseNames,
      ...tools.map((tool) => tool.id),
      ...tools.map((tool) => tool.modelName),
    ])
    for (const skill of skills) {
      if (skill.requiredCapabilities.some((id) => !available.has(id)))
        throw new Error('SKILL_DEPENDENCY_MISSING')
    }
    const estimatedContextTokens = Math.ceil(
      skills.reduce(
        (sum, skill) =>
          sum + (skill.files.find((file) => file.relativePath === 'SKILL.md')?.size ?? 0),
        0,
      ) +
        JSON.stringify(tools).length * 3,
    )
    if (estimatedContextTokens + contextSettings(budget).output + 128 > budget)
      throw new Error('EXTENSION_CONTEXT_BUDGET_EXCEEDED')
    const payload = {
      ...(selection.mediaBindings ? { mediaBindings: selection.mediaBindings } : {}),
      mode: mode as 'analyze' | 'develop' | 'review',
      schemaVersion: 1 as const,
      workspace: scope.workspace,
      catalogRevision: catalog.catalogRevision,
      policyEpoch: catalog.policyEpoch,
      skills,
      servers,
      tools,
    }
    const snapshot: Snapshot = { ...payload, snapshotDigest: digest(payload) }
    return { snapshot, totalToolCount, estimatedContextTokens }
  }
  check(snapshot: Snapshot): void {
    if (
      [...snapshot.skills, ...snapshot.servers].some((item) =>
        this.ports.repo.revoked(item.id, snapshot.policyEpoch),
      )
    )
      throw new Error('CAPABILITY_REVOKED')
  }
  binding(scope: Scope): Binding {
    const id = scopeKey(scope)
    return this.ports.repo.binding(id) ?? { id, revision: 0, scope, selection: emptySelection() }
  }
}
