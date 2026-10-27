import {
  createMcpExtension,
  DefaultResourceLoader,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { ToolContext } from '../../application/ports.js'
import type { RunExtensions } from '../../extensions/application/ports.js'
import type { Snapshot } from '../../extensions/domain/types.js'
import { object } from '../../domain/types.js'
import { digest } from './skill-files.js'
import { compileSchema } from './schema-validator.js'
import { guardedTransport, invocation } from './transport.js'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
export async function mcpResources(input: {
  directory: string
  snapshot: Snapshot
  extensions: RunExtensions
  context: ToolContext
  secrets: Record<string, Record<string, string>>
  processEvent?: (pid: number, state: 'start' | 'end') => void
}) {
  const { snapshot, extensions, context } = input
  const transports: ReturnType<typeof guardedTransport>[] = []
  const generations = new Map<string, number>(),
    ready = new Set<string>()
  let stopped = false,
    failure: string | undefined
  const check = (): void => {
    if (stopped) throw new Error('CANCELLED')
    extensions.check(snapshot)
  }
  const official = createMcpExtension({
    loadConfig: () => ({
      errors: [],
      autoEnableCodemode: false,
      servers: snapshot.servers.map((server) => ({
        name: server.id,
        source: 'managed',
        scope: 'extension',
        config: {
          ...(server.transport.type === 'stdio'
            ? {
                type: 'stdio' as const,
                command: server.transport.executable,
                args: server.transport.args,
                cwd: server.transport.cwd,
              }
            : { type: 'http' as const, url: server.transport.url }),
          enabled: true,
          exposure: 'hidden',
          toolExposure: Object.fromEntries(
            snapshot.tools
              .filter((tool) => tool.serverId === server.id)
              .map((tool) => [tool.originalName, 'direct' as const]),
          ),
          timeout: 15,
        },
      })),
    }),
    updateConfig: () => {
      throw new Error('MCP_CONFIG_MANAGED_BY_APP')
    },
    openUrl: () => {
      throw new Error('MCP_OAUTH_UNSUPPORTED')
    },
    logPath: join(input.directory, 'mcp-diagnostics-disabled.log'),
    startupWaitMs: 15000,
    createTransport: (entry) => {
      const server = snapshot.servers.find((item) => item.id === entry.name)
      if (!server) throw new Error('MCP_SERVER_NOT_ALLOWED')
      const generation = (generations.get(server.id) ?? 0) + 1
      generations.set(server.id, generation)
      const transport = guardedTransport({
        server,
        snapshot,
        secrets: input.secrets[server.id] ?? {},
        generation,
        check,
        processEvent: input.processEvent,
        onFailure: (code) => {
          failure = code
        },
      })
      transports.push(transport)
      transport.onError(() => {
        failure = 'MCP_TRANSPORT_FAILED'
      })
      return transport
    },
  })
  const bootstrap = join(input.directory, 'bootstrap')
  await mkdir(bootstrap, { recursive: true, mode: 0o700 })
  const loader = new DefaultResourceLoader({
    cwd: bootstrap,
    agentDir: input.directory,
    settingsManager: SettingsManager.inMemory(
      { packages: [], extensions: [], skills: [], prompts: [], themes: [] },
      { projectTrusted: false },
    ),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [],
    additionalSkillPaths: [],
    additionalPromptTemplatePaths: [],
    additionalThemePaths: [],
    systemPrompt: '',
    appendSystemPrompt: [],
    extensionFactories: [
      (api) =>
        official({
          ...api,
          registerTool(definition) {
            const tool = snapshot.tools.find(
              (item) =>
                definition.label === `${item.serverId}/${item.originalName}` &&
                definition.name === item.modelName &&
                definition.namespace?.name === `mcp__${item.serverId}`,
            )
            if (!tool || definition.exposure === 'hidden') return
            if (digest(definition.parameters) !== tool.schemaDigest) {
              failure = 'MCP_SCHEMA_CHANGED'
              return
            }
            const validate = compileSchema(tool.inputSchema),
              generation = generations.get(tool.serverId) ?? 0
            api.registerTool({
              ...definition,
              executionMode: 'sequential',
              execute: (id, args, signal, onUpdate, ctx) =>
                context.invoke(id, tool.modelName, async () => {
                  check()
                  const copied = structuredClone(args)
                  const params = object(copied)
                  if (!validate(copied)) throw new Error('MCP_INPUT_INVALID')
                  await context.authorizeTool(id, tool, params, signal)
                  check()
                  if (generations.get(tool.serverId) !== generation)
                    throw new Error('MCP_SCHEMA_CHANGED')
                  return invocation.run(
                    { tool, args: structuredClone(params), generation },
                    async () => {
                      try {
                        return await definition.execute(id, copied, signal, undefined, ctx)
                      } catch (error) {
                        const code =
                          error instanceof Error
                            ? error.message.match(/\bMCP_[A-Z0-9_]+\b/)?.[0]
                            : undefined
                        throw new Error(
                          signal?.aborted
                            ? 'CANCELLED'
                            : !code || code === 'MCP_TRANSPORT_FAILED'
                              ? 'MCP_RESULT_UNKNOWN'
                              : code,
                        )
                      }
                    },
                  )
                }),
            })
            ready.add(tool.id)
          },
        }),
    ],
  })
  await loader.reload()
  const loaded = loader.getExtensions()
  if (loaded.errors.length) throw new Error('EXTENSION_INIT_FAILED')
  return {
    loaded,
    async wait(): Promise<void> {
      const deadline = Date.now() + 15000
      while (ready.size !== snapshot.tools.filter((tool) => tool.serverId !== 'builtin').length) {
        check()
        if (failure) throw new Error(failure)
        if (Date.now() > deadline) throw new Error('MCP_TOOLS_NOT_READY')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    async close(): Promise<void> {
      stopped = true
      await Promise.all(transports.map((transport) => transport.close()))
    },
  }
}
