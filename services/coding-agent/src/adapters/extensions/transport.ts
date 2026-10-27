import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  type McpTransport,
  type JsonRpcMessage,
  type Tool as McpTool,
} from '@earendil-works/pi-mcp'
import type { Inventory, Server, Snapshot, Tool } from '../../extensions/domain/types.js'
import { canonical } from '../../extensions/domain/types.js'
import { digest } from './skill-files.js'
import { inventoryTools } from './schema-validator.js'
import { boundedFetch } from './bounded-fetch.js'
function boundedJson(value: unknown, depth = 0, budget = { left: 2048 }): void {
  if (depth > 24 || --budget.left < 0) throw new Error('MCP_RESULT_TOO_LARGE')
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('MCP_RESULT_UNSUPPORTED')
  if (value && typeof value === 'object')
    for (const item of Object.values(value)) boundedJson(item, depth + 1, budget)
}
export const invocation = new AsyncLocalStorage<{
  tool: Tool
  args: Record<string, unknown>
  generation: number
}>()
function mapStrings(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value !== 'string') throw new Error('MCP_CONFIG_UNSUPPORTED')
      return [key, value]
    }),
  )
}
export async function validateExecutable(server: Server): Promise<void> {
  if (server.transport.type !== 'stdio') return
  try {
    await access(server.transport.executable, constants.X_OK)
    if (
      !(await stat(server.transport.executable)).isFile() ||
      !(await stat(server.transport.cwd)).isDirectory()
    )
      throw new Error('MCP_EXECUTABLE_NOT_FOUND')
  } catch {
    throw new Error('MCP_EXECUTABLE_NOT_FOUND')
  }
}
export function guardedTransport(input: {
  server: Server
  secrets: Record<string, string>
  generation: number
  snapshot?: Snapshot
  check(): void
  onFailure?(code: string): void
  processEvent?(pid: number, state: 'start' | 'end'): void
}): McpTransport {
  const { server, secrets } = input,
    configuration = server.transport
  const secretValues = Object.keys(configuration.secretRefs).flatMap((key) => {
    if (!Object.hasOwn(secrets, key)) throw new Error('MCP_CREDENTIAL_UNAVAILABLE')
    const value = secrets[key]
    return value.startsWith('Bearer ') ? [value, value.slice(7)] : [value]
  })
  const redact = (text: string): string =>
    secretValues.reduce(
      (value, secret) => (secret ? value.replaceAll(secret, '[redacted]') : value),
      text,
    )
  const raw =
    configuration.type === 'stdio'
      ? new StdioTransport({
          command: configuration.executable,
          args: configuration.args,
          cwd: configuration.cwd,
          env: {
            PATH: '/usr/bin:/bin',
            LANG: 'en_US.UTF-8',
            ...mapStrings(configuration.publicEnv),
            ...secrets,
          },
          inheritEnv: false,
          stderr: 'pipe',
          maxStderrBytes: 1,
          maxMessageBytes: 1024 * 1024,
          closeTimeoutMs: 2000,
        })
      : new StreamableHttpTransport({
          url: configuration.url,
          headers: { ...mapStrings(configuration.publicHeaders), ...secrets },
          fetch: boundedFetch(configuration.url, input.check),
          openGetStream: false,
          maxMessageBytes: 1024 * 1024,
          reconnect: { maxRetries: 0 },
        })
  const methods = new Map<string | number, string>()
  let closed = false
  let processId: number | undefined
  const processEnded = (): void => {
    if (processId) input.processEvent?.(processId, 'end')
    processId = undefined
  }
  raw.onClose(processEnded)
  let closing: Promise<void> | undefined
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      closed = true
      try {
        await raw.close()
      } finally {
        processEnded()
      }
    })())
  return {
    async start() {
      input.check()
      await validateExecutable(server)
      if (closed) throw new Error('CANCELLED')
      await raw.start()
      if (raw instanceof StdioTransport && raw.pid) {
        processId = raw.pid
        input.processEvent?.(processId, 'start')
      }
    },
    async send(message, options) {
      input.check()
      if (closed || options?.signal?.aborted) throw new Error('CANCELLED')
      if ('method' in message) {
        if (message.method === 'tools/call') {
          const active = invocation.getStore(),
            params = message.params as { name?: unknown; arguments?: unknown } | undefined
          if (
            !active ||
            active.generation !== input.generation ||
            active.tool.serverId !== server.id ||
            params?.name !== active.tool.originalName ||
            canonical(params.arguments) !== canonical(active.args)
          )
            throw new Error('MCP_ADMISSION_REQUIRED')
        } else if (
          ![
            'initialize',
            'notifications/initialized',
            'tools/list',
            'resources/list',
            'resources/templates/list',
            'ping',
            'notifications/cancelled',
          ].includes(message.method)
        )
          throw new Error('MCP_METHOD_NOT_ALLOWED')
        if ('id' in message && message.id !== null) methods.set(message.id, message.method)
      }
      try {
        await raw.send(message, options)
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'MCP_TRANSPORT_FAILED'
        input.onFailure?.(code)
        throw new Error(code)
      }
    },
    onMessage(listener) {
      return raw.onMessage((message) => {
        if ('method' in message) return // Server logging, progress, sampling and unsolicited requests are never forwarded.
        const method = methods.get(message.id)
        methods.delete(message.id)
        try {
          let filtered: JsonRpcMessage = message
          if ('result' in message && method === 'tools/list') {
            const result = message.result as { tools: McpTool[] }
            const tools = inventoryTools(server, result.tools)
            for (const expected of input.snapshot?.tools.filter(
              (tool) => tool.serverId === server.id,
            ) ?? []) {
              if (
                !tools.some(
                  (tool) =>
                    tool.originalName === expected.originalName &&
                    tool.schemaDigest === expected.schemaDigest &&
                    tool.modelName === expected.modelName,
                )
              )
                throw new Error('MCP_SCHEMA_CHANGED')
            }
          }
          if (method === 'tools/call') {
            if ('error' in message) throw new Error('MCP_TOOL_FAILED')
            const result = message.result as {
              content?: { type: string; text?: string }[]
              structuredContent?: unknown
              isError?: boolean
            }
            if (
              !Array.isArray(result.content) ||
              result.content.some(
                (block) => block.type !== 'text' || typeof block.text !== 'string',
              )
            )
              throw new Error('MCP_RESULT_UNSUPPORTED')
            boundedJson(result.structuredContent)
            if (result.isError !== undefined && typeof result.isError !== 'boolean')
              throw new Error('MCP_RESULT_UNSUPPORTED')
            const text = redact(
              JSON.stringify({
                content: result.content.map((block) => ({ type: 'text', text: block.text })),
                structuredContent: result.structuredContent,
                isError: result.isError,
              }),
            )
            if (Buffer.byteLength(text) > 12288) throw new Error('MCP_RESULT_TOO_LARGE')
            filtered = { ...message, result: JSON.parse(text) as unknown }
          }
          listener(filtered)
        } catch (error) {
          const code =
            error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
              ? error.message
              : 'MCP_RESULT_UNSUPPORTED'
          input.onFailure?.(code)
          listener({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: code } })
        }
      })
    },
    onError(listener) {
      return raw.onError(() => listener(new Error('MCP_TRANSPORT_FAILED')))
    },
    onClose(listener) {
      return raw.onClose(listener)
    },
    setProtocolVersion(version) {
      if ('setProtocolVersion' in raw) raw.setProtocolVersion(version)
    },
    close,
  }
}
export class McpConnections {
  constructor(private processEvent?: (pid: number, state: 'start' | 'end') => void) {}
  async inspect(
    server: Server,
    secrets: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Inventory> {
    const transport = guardedTransport({
      server,
      secrets,
      generation: 0,
      check: () => {
        if (signal.aborted) throw new Error('CANCELLED')
      },
      processEvent: this.processEvent,
    })
    const client = new McpClient({ name: 'ownloom', version: '0.1.0', requestTimeoutMs: 10000 })
    const stop = (): void => {
      void transport.close()
    }
    signal.addEventListener('abort', stop, { once: true })
    try {
      await client.connect(transport)
      const tools = inventoryTools(server, await client.listTools({ signal, timeoutMs: 10000 }))
      const resources = client.serverCapabilities?.resources
        ? (await client.listResourcesPage(undefined, { signal, timeoutMs: 5000 })).resources
            .slice(0, 200)
            .map((resource) => ({ uri: resource.uri, name: resource.name }))
        : []
      return {
        serverId: server.id,
        configRevision: server.revision,
        inventoryRevision: Date.now(),
        digest: digest(tools),
        tools,
        resources,
      }
    } finally {
      signal.removeEventListener('abort', stop)
      await client.close()
      await transport.close()
    }
  }
}
