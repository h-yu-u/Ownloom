import type { components } from './generated-schema'
import { record, text, list, number } from './decoders'
export type ExtensionCatalog = components['schemas']['ExtensionCatalog']
export type ExtensionSkill = components['schemas']['ExtensionSkill']
export type ExtensionServer = components['schemas']['McpServer']
export type ExtensionInventory = components['schemas']['McpInventory']
export type ExtensionTool = components['schemas']['ExtensionTool']
export type ExtensionScope = components['schemas']['ExtensionScope']
export type ExtensionSelection = components['schemas']['ExtensionSelection']
export type ExtensionBinding = components['schemas']['ExtensionBinding']
export type ExtensionResolution = components['schemas']['ExtensionResolution']
export type ExtensionOperation = components['schemas']['ExtensionOperation']
export type ExtensionSnapshot = components['schemas']['ExtensionSnapshot']
export type McpWriteRequest = components['schemas']['McpWriteRequest']
export type SkillImportRequest = components['schemas']['SkillImportRequest']
export type SkillInspection = components['schemas']['SkillInspection']
export type ExtensionMutation = components['schemas']['ExtensionMutation']
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('扩展协议无效')
  return value
}
function choice<T extends string | number>(value: unknown, values: readonly T[]): T {
  const selected = values.find((item) => item === value)
  if (selected === undefined) throw new Error('扩展协议版本不兼容')
  return selected
}
function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, text(item)]))
}
export function decodeSkill(value: unknown): ExtensionSkill {
  const v = record(value)
  return {
    id: text(v.id),
    revision: number(v.revision),
    digest: text(v.digest),
    name: text(v.name),
    description: text(v.description),
    enabled: flag(v.enabled),
    ...(v.contentRevision ? { contentRevision: number(v.contentRevision) } : {}),
    source: choice(v.source, ['local-import', 'builtin']),
    sourceRef: text(v.sourceRef),
    workspaces: list(v.workspaces, (item) => choice(item, ['chat', 'coding', 'image', 'audio'])),
    requiredCapabilities: list(v.requiredCapabilities, text),
    files: list(v.files, (item) => {
      const f = record(item)
      return { relativePath: text(f.relativePath), digest: text(f.digest), size: number(f.size) }
    }),
  }
}
export function decodeServer(value: unknown): ExtensionServer {
  const v = record(value),
    t = record(v.transport),
    type = choice(t.type, ['stdio', 'streamable-http'])
  const transport =
    type === 'stdio'
      ? {
          type,
          executable: text(t.executable),
          args: list(t.args, text),
          cwd: text(t.cwd),
          publicEnv: strings(t.publicEnv),
          secretRefs: strings(t.secretRefs),
        }
      : {
          type,
          url: text(t.url),
          publicHeaders: strings(t.publicHeaders),
          secretRefs: strings(t.secretRefs),
          authMode: choice(t.authMode, ['none', 'bearer', 'api-key']),
        }
  return {
    id: text(v.id),
    revision: number(v.revision),
    digest: text(v.digest),
    name: text(v.name),
    enabled: flag(v.enabled),
    credentialConfigured: flag(v.credentialConfigured),
    transport,
    allowedTools: list(v.allowedTools, text),
    readOnlyTools: list(v.readOnlyTools, text),
  }
}
export function decodeTool(value: unknown): ExtensionTool {
  const v = record(value)
  return {
    id: text(v.id),
    serverId: text(v.serverId),
    originalName: text(v.originalName),
    modelName: text(v.modelName),
    schemaDigest: text(v.schemaDigest),
    description: text(v.description),
    inputSchema: record(v.inputSchema),
    risk: choice(v.risk, ['read', 'ask']),
  }
}
export function decodeInventory(value: unknown): ExtensionInventory {
  const v = record(value)
  return {
    serverId: text(v.serverId),
    configRevision: number(v.configRevision),
    inventoryRevision: number(v.inventoryRevision),
    digest: text(v.digest),
    tools: list(v.tools, decodeTool),
    resources: list(v.resources, (item) => {
      const r = record(item)
      return { uri: text(r.uri), name: text(r.name) }
    }),
  }
}
export function decodeExtensionCatalog(value: unknown): ExtensionCatalog {
  const v = record(value)
  return {
    catalogRevision: number(v.catalogRevision),
    policyEpoch: number(v.policyEpoch),
    skills: list(v.skills, decodeSkill),
    servers: list(v.servers, decodeServer),
    inventories: list(v.inventories, decodeInventory),
    builtinTools: list(v.builtinTools, decodeTool),
  }
}
export function decodeSelection(value: unknown): ExtensionSelection {
  const v = record(value)
  return {
    skillIds: list(v.skillIds, text),
    toolIds: list(v.toolIds, text),
    ...(v.mediaBindings ? { mediaBindings: decodeMedia(v.mediaBindings) } : {}),
  }
}
export function decodeExtensionSnapshot(value: unknown): ExtensionSnapshot {
  const v = record(value)
  return {
    schemaVersion: choice(v.schemaVersion, [1]),
    workspace: choice(v.workspace, ['chat', 'coding', 'image', 'audio']),
    catalogRevision: number(v.catalogRevision),
    policyEpoch: number(v.policyEpoch),
    skills: list(v.skills, decodeSkill),
    servers: list(v.servers, decodeServer),
    tools: list(v.tools, decodeTool),
    snapshotDigest: text(v.snapshotDigest),
    ...(v.mode ? { mode: choice(v.mode, ['analyze', 'develop', 'review'] as const) } : {}),
    ...(v.mediaBindings ? { mediaBindings: decodeMedia(v.mediaBindings) } : {}),
  }
}
export function decodeResolution(value: unknown): ExtensionResolution {
  const v = record(value)
  return {
    snapshot: decodeExtensionSnapshot(v.snapshot),
    totalToolCount: number(v.totalToolCount),
    estimatedContextTokens: number(v.estimatedContextTokens),
  }
}
export function decodeBinding(value: unknown): ExtensionBinding {
  const v = record(value),
    s = record(v.scope)
  return {
    id: text(v.id),
    revision: number(v.revision),
    scope: {
      workspace: choice(s.workspace, ['chat', 'coding', 'image', 'audio']),
      kind: choice(s.kind, ['workspace', 'project', 'session']),
      scopeId: text(s.scopeId),
    },
    selection: decodeSelection(v.selection),
  }
}
export function decodeOperation(value: unknown): ExtensionOperation {
  const v = record(value)
  return {
    id: text(v.id),
    serverId: text(v.serverId),
    state: choice(v.state, ['running', 'succeeded', 'failed', 'cancelled', 'interrupted']),
    errorCode: v.errorCode === null ? null : text(v.errorCode),
    inventory: v.inventory === null ? null : decodeInventory(v.inventory),
  }
}
export function decodeMutation(value: unknown): ExtensionMutation {
  const v = record(value)
  return {
    mutationId: text(v.mutationId),
    targetId: text(v.targetId),
    revision: number(v.revision),
  }
}
export function decodeSkillInspection(value: unknown): SkillInspection {
  const v = record(value)
  return { skill: decodeSkill(v.skill), body: text(v.body), diagnostics: list(v.diagnostics, text) }
}

function decodeMedia(value: unknown): NonNullable<ExtensionSelection['mediaBindings']> {
  const v = record(value)
  return {
    ...(v.imageModelId ? { imageModelId: text(v.imageModelId) } : {}),
    ...(v.imageMode
      ? { imageMode: choice(v.imageMode, ['generate', 'edit', 'inpaint'] as const) }
      : {}),
    ...(v.imageReferenceIds ? { imageReferenceIds: list(v.imageReferenceIds, text) } : {}),
    ...(v.imageMaskId ? { imageMaskId: text(v.imageMaskId) } : {}),
    ...(v.speechModelId ? { speechModelId: text(v.speechModelId) } : {}),
    ...(v.speechMode ? { speechMode: choice(v.speechMode, ['preset', 'clone'] as const) } : {}),
    ...(v.speaker ? { speaker: text(v.speaker) } : {}),
    ...(v.voiceId ? { voiceId: text(v.voiceId) } : {}),
  }
}
