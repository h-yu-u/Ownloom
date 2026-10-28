import type {
  Binding,
  Catalog,
  Event,
  Inventory,
  Mutation,
  Operation,
  Server,
  Skill,
  Snapshot,
} from '../domain/types.js'
export interface ExtensionRepository {
  catalog(): Catalog
  skill(id: string, revision?: number): Skill
  server(id: string, revision?: number): Server
  binding(id: string): Binding | undefined
  inventory(id: string, revision: number): Inventory
  mutation(id: string, intent?: string): Mutation | null
  commit(input: {
    mutationId: string
    intent: string
    targetId: string
    expectedRevision: number
    kind: 'skill' | 'server' | 'binding'
    value: Skill | Server | Binding
    event: Event['type']
  }): Mutation
  revoke(mutationId: string, intent: string, targetId: string): Mutation
  revoked(id: string, since: number): boolean
  saveInventory(inventory: Inventory): void
  operation(id: string): Operation
  saveOperation(operation: Operation): void
  events(after: number): { events: Event[]; watermark: number }
  wait(after: number): Promise<{ events: Event[]; watermark: number }>
  close(): void
}
export interface SkillContent {
  name: string
  description: string
  files: Skill['files']
  digest: string
  sourceRef: string
}
export interface SkillPublication {
  readonly value: SkillContent
  read(relativePath: string): Promise<string>
  publish(): Promise<void>
  commit(): void
  abort(): Promise<void>
}
export interface SkillFiles {
  preview(
    path: string,
    workspaces: Skill['workspaces'],
    requiredCapabilities: string[],
  ): Promise<{ skill: Skill; body: string; diagnostics: string[] }>
  stage(path: string, id: string, revision: number): Promise<SkillPublication>
  read(skill: Skill, relativePath: string): Promise<string>
}
export interface McpConnections {
  inspect(server: Server, secrets: Record<string, string>, signal: AbortSignal): Promise<Inventory>
}
export interface ExtensionPorts {
  builtinSkills?: { id: string; path: string; workspaces: Skill['workspaces'] }[]
  repo: ExtensionRepository
  files: SkillFiles
  mcp: McpConnections
  digest(value: unknown): string
  revokeRuns(targetId: string): Promise<void>
}
export interface RunExtensions {
  resolve(
    scope: Binding['scope'],
    selection?: Binding['selection'],
    mode?: string,
    budget?: number,
  ): { snapshot: Snapshot; totalToolCount: number; estimatedContextTokens: number }
  read(skill: Skill, relativePath: string): Promise<string>
  check(snapshot: Snapshot): void
}
