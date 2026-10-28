import type {
  RepositoryPort,
  Provider,
  PiSession,
  ToolContext,
  ActiveCapability,
  RunRuntime,
} from './ports.js'
import type { Snapshot } from '../extensions/domain/types.js'
import type { Extensions } from '../extensions/application/service.js'

export interface AgentPorts {
  repo: RepositoryPort
  extensions: Extensions
  codingBusy(): boolean
  modelAllowed(provider: Provider): boolean
  activate(runtime: RunRuntime, signal: AbortSignal): Promise<ActiveCapability>
  closeCapability(runtime: RunRuntime, active?: ActiveCapability): Promise<void>
  open(input: {
    directory: string
    root: string
    instructions: string
    transcript: { id: string; piPath: string | null }
    provider: Provider
    context: ToolContext
    snapshot: Snapshot
    capability: ActiveCapability
    skillInstructions: string
    connectionSecrets: Record<string, Record<string, string>>
  }): Promise<{ session: PiSession; path(): string | undefined }>
}
