import type { ExtensionPorts } from './ports.js'
import { ResourceResolver } from './resolver.js'
import { scopeKey, type Operation, type Server, type Skill } from '../domain/types.js'
import type { RpcParamsMap } from '../../protocol/generated/types.js'
export class Extensions {
  readonly resolver: ResourceResolver
  readonly ready: Promise<void>
  private writes: Promise<unknown> = Promise.resolve()
  private operations = new Map<string, { abort: AbortController; task: Promise<void> }>()
  constructor(readonly ports: ExtensionPorts) {
    this.resolver = new ResourceResolver(ports)
    this.ready = this.seed()
  }
  private async seed(): Promise<void> {
    for (const builtin of this.ports.builtinSkills ?? []) {
      if (this.ports.repo.catalog().skills.some((skill) => skill.id === builtin.id)) continue
      await this.importSkill(
        {
          mutationId: builtin.id,
          path: builtin.path,
          id: builtin.id,
          expectedRevision: 0,
          workspaces: builtin.workspaces,
          requiredCapabilities: [],
        },
        'builtin',
      )
    }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action)
    this.writes = result.catch(() => {})
    return result
  }
  private async importSkill(
    p: RpcParamsMap['extensions.skills.import'],
    source: Skill['source'] = 'local-import',
  ) {
    const intent = this.ports.digest(p),
      { repo, files, digest } = this.ports
    const prior = repo.mutation(p.mutationId, intent)
    if (prior) return prior
    const id = p.id ?? `sk_${digest(p.mutationId).slice(0, 24)}`,
      expectedRevision = p.expectedRevision ?? 0
    if (p.id && expectedRevision > 0 && repo.skill(p.id).revision !== expectedRevision)
      throw new Error('EXTENSION_REVISION_CONFLICT')
    const imported = await files.import(p.path, id, expectedRevision + 1)
    if (p.expectedDigest && p.expectedDigest !== imported.digest)
      throw new Error('SKILL_CONTENT_CHANGED')
    if (repo.catalog().skills.some((item) => item.id !== id && item.name === imported.name))
      throw new Error('SKILL_NAME_CONFLICT')
    const skill: Skill = {
      ...imported,
      id,
      revision: expectedRevision + 1,
      contentRevision: expectedRevision + 1,
      source,
      enabled: true,
      workspaces: p.workspaces,
      requiredCapabilities: p.requiredCapabilities,
    }
    return repo.commit({
      mutationId: p.mutationId,
      intent,
      targetId: id,
      expectedRevision,
      kind: 'skill',
      value: skill,
      event: 'skill.version_published',
    })
  }
  private saveServer(p: RpcParamsMap['extensions.mcp.save']) {
    const { repo, digest } = this.ports,
      intent = digest(p)
    const prior = repo.mutation(p.mutationId, intent)
    if (prior) return prior
    if (p.id && p.expectedRevision === 0) throw new Error('EXTENSION_REVISION_CONFLICT')
    const id = p.id ?? `s_${digest(p.mutationId).slice(0, 20)}`
    const transport = p.transport
    if (transport.type === 'stdio') {
      if (
        !transport.executable.startsWith('/') ||
        !transport.cwd.startsWith('/') ||
        /(?:^|\/)npx$|(?:^|\/)uvx$/.test(transport.executable)
      )
        throw new Error('MCP_EXECUTABLE_NOT_ALLOWED')
      if (
        Object.keys(transport.publicEnv).some((key) => /TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(key))
      )
        throw new Error('MCP_SECRET_FIELD_REQUIRED')
    } else {
      const url = new URL(transport.url)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
      )
        throw new Error('MCP_URL_NOT_ALLOWED')
      if (
        Object.keys(transport.publicHeaders).some((key) =>
          /authorization|cookie|key|token|secret/i.test(key),
        )
      )
        throw new Error('MCP_SECRET_FIELD_REQUIRED')
    }
    if (
      JSON.stringify(transport).includes('!command') ||
      Object.values(
        transport.type === 'stdio' ? transport.publicEnv : transport.publicHeaders,
      ).some((value) => typeof value !== 'string' || /\$\{|\$\(|`/.test(value))
    )
      throw new Error('MCP_CONFIG_UNSUPPORTED')
    if (p.readOnlyTools.some((name) => !p.allowedTools.includes(name)))
      throw new Error('MCP_TOOL_NOT_ALLOWED')
    const server: Server = {
      id,
      revision: p.expectedRevision + 1,
      digest: digest(p),
      name: p.name,
      enabled: p.enabled,
      transport,
      allowedTools: p.allowedTools,
      readOnlyTools: p.readOnlyTools,
      credentialConfigured: Object.keys(transport.secretRefs).length > 0,
    }
    return repo.commit({
      mutationId: p.mutationId,
      intent,
      targetId: id,
      expectedRevision: p.expectedRevision,
      kind: 'server',
      value: server,
      event: 'extension.config_updated',
    })
  }
  private test(p: RpcParamsMap['extensions.mcp.test']): Operation {
    const { repo, mcp, digest } = this.ports,
      server = repo.server(p.id, p.configRevision)
    const id = `op_${digest([p.id, Date.now(), Math.random()]).slice(0, 24)}`
    const operation: Operation = {
      id,
      serverId: p.id,
      state: 'running',
      inventory: null,
      errorCode: null,
    }
    repo.saveOperation(operation)
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 15000)
    const task = Promise.resolve().then(async () => {
      try {
        const inventory = await mcp.inspect(server, p.connectionSecrets ?? {}, abort.signal)
        if (abort.signal.aborted) throw new Error('CANCELLED')
        repo.saveInventory(inventory)
        repo.saveOperation({ ...operation, state: 'succeeded', inventory })
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'MCP_CONNECT_FAILED'
        repo.saveOperation({
          ...operation,
          state: abort.signal.aborted ? 'cancelled' : 'failed',
          errorCode: code,
        })
      } finally {
        clearTimeout(timer)
        this.operations.delete(id)
      }
    })
    this.operations.set(id, { abort, task })
    return operation
  }
  async dispatch(method: string, raw: unknown): Promise<unknown> {
    await this.ready
    const { repo, digest } = this.ports
    // The generated boundary validates raw before this dispatch.
    switch (method) {
      case 'extensions.skills.preview': {
        const p = raw as RpcParamsMap['extensions.skills.preview']
        return this.ports.files.preview(p.path, p.workspaces, p.requiredCapabilities)
      }
      case 'extensions.check': {
        this.resolver.check((raw as RpcParamsMap['extensions.check']).snapshot)
        return { valid: true }
      }
      case 'extensions.catalog.list':
        return repo.catalog()
      case 'extensions.skills.import':
      case 'extensions.skills.publish':
        return this.serial(() => this.importSkill(raw as RpcParamsMap['extensions.skills.import']))
      case 'extensions.skills.inspect': {
        const p = raw as RpcParamsMap['extensions.skills.inspect'],
          skill = repo.skill(p.id, p.revision)
        return { skill, body: await this.ports.files.read(skill, 'SKILL.md'), diagnostics: [] }
      }
      case 'extensions.skills.update': {
        const p = raw as RpcParamsMap['extensions.skills.update']
        return this.serial(async () => {
          const prior = repo.mutation(p.mutationId, digest(p))
          if (prior) return prior
          const skill = {
            ...repo.skill(p.id),
            contentRevision: repo.skill(p.id).contentRevision ?? repo.skill(p.id).revision,
            enabled: p.enabled,
            revision: p.expectedRevision + 1,
          }
          return repo.commit({
            mutationId: p.mutationId,
            intent: digest(p),
            targetId: p.id,
            expectedRevision: p.expectedRevision,
            kind: 'skill',
            value: skill,
            event: 'extension.config_updated',
          })
        })
      }
      case 'extensions.mcp.save':
        return this.serial(async () => this.saveServer(raw as RpcParamsMap['extensions.mcp.save']))
      case 'extensions.mcp.inspect': {
        const p = raw as RpcParamsMap['extensions.mcp.inspect']
        return repo.server(p.id, p.revision)
      }
      case 'extensions.mcp.test':
        return this.test(raw as RpcParamsMap['extensions.mcp.test'])
      case 'extensions.mcp.tools': {
        const p = raw as RpcParamsMap['extensions.mcp.tools']
        return repo.inventory(p.id, p.configRevision)
      }
      case 'extensions.operations.get':
        return repo.operation((raw as { id: string }).id)
      case 'extensions.operations.cancel': {
        const p = raw as { id: string },
          operation = this.operations.get(p.id)
        operation?.abort.abort()
        await operation?.task
        return repo.operation(p.id)
      }
      case 'extensions.mutations.get':
        return repo.mutation((raw as { id: string }).id)
      case 'extensions.bindings.get':
        return this.resolver.binding(raw as RpcParamsMap['extensions.bindings.get'])
      case 'extensions.bindings.update': {
        const p = raw as RpcParamsMap['extensions.bindings.update']
        return this.serial(async () => {
          const prior = repo.mutation(p.mutationId, digest(p))
          if (prior) return prior
          this.resolver.resolve(
            p.scope,
            p.selection,
            'develop',
            32768,
            p.scope.workspace === 'chat' && p.scope.kind === 'session',
          )
          const id = scopeKey(p.scope),
            value = { id, revision: p.expectedRevision + 1, scope: p.scope, selection: p.selection }
          return repo.commit({
            mutationId: p.mutationId,
            intent: digest(p),
            targetId: id,
            expectedRevision: p.expectedRevision,
            kind: 'binding',
            value,
            event: 'extension.config_updated',
          })
        })
      }
      case 'extensions.resolve': {
        const p = raw as RpcParamsMap['extensions.resolve']
        return this.resolver.resolve(
          p.scope,
          p.selection,
          p.mode,
          p.contextBudget,
          p.channel === 'agent',
        )
      }
      case 'extensions.revoke': {
        const p = raw as RpcParamsMap['extensions.revoke']
        const prior = repo.mutation(p.mutationId, digest(p))
        if (prior) return prior
        const result = repo.revoke(p.mutationId, digest(p), p.targetId)
        await this.ports.revokeRuns(p.targetId)
        return result
      }
      case 'extensions.events.wait':
        return repo.wait((raw as { after?: number }).after ?? 0)
      default:
        throw new Error('UNKNOWN_METHOD')
    }
  }
  async close(): Promise<void> {
    for (const operation of this.operations.values()) operation.abort.abort()
    await Promise.all([...this.operations.values()].map((operation) => operation.task))
    await this.ready
    await this.writes
    repoClose(this.ports)
  }
}
function repoClose(ports: ExtensionPorts): void {
  ports.repo.close()
}
