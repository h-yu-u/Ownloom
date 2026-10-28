import { evaluateToolPolicy } from '../domain/tool-policy.js'
import { approvalBinding } from './approval-binding.js'
import { ToolGateway } from './tool-gateway.js'
import type { Tool } from '../extensions/domain/types.js'
import type { Project, Run } from '../domain/types.js'
import type { RepositoryPort, RunPorts, ToolContext } from './ports.js'
import type { Approvals } from './approvals.js'
interface PolicyInput {
  repo: RepositoryPort
  ports: RunPorts
  run: Run
  project: Project
  abort: AbortController
  approvals: Approvals
  update(patch: Partial<Run>): void
  command: ToolContext['command']
}
export class RunPolicy {
  private gateway: ToolGateway
  constructor(private input: PolicyInput) {
    this.gateway = new ToolGateway({
      check: () => this.check(),
      started: (id, name) => this.started(id, name),
      finished: (id, name, errorCode) =>
        input.repo.append(input.run.sessionId, input.run.id, 'tool.settled', name, {
          toolCallId: id,
          errorCode,
        }),
    })
  }
  private check(): void {
    if (this.input.abort.signal.aborted) throw new Error('CANCELLED')
    if (this.input.run.capabilitySnapshot)
      this.input.ports.extensions?.check(this.input.run.capabilitySnapshot)
  }
  context(): ToolContext {
    const { project, run, ports, command, update } = this.input
    return {
      root: project.path,
      mode: run.mode,
      workspace: ports.workspace(project.path, run),
      command,
      invoke: (id, name, execute) => this.gateway.invoke(id, name, execute),
      authorizeTool: (id, tool, args, signal) => this.authorizeTool(id, tool, args, signal),
      authorizeWrite: (id, path, content, expected) =>
        this.authorizeWrite(id, path, content, expected),
      changed: () => update({ verification: 'not_run', fingerprint: null }),
    }
  }
  private started(id: string, name: string): void {
    const { run, repo, abort, update } = this.input
    if (abort.signal.aborted) throw new Error('CANCELLED')
    update({
      phase: ['write', 'edit'].includes(name)
        ? 'editing'
        : name === 'run_command'
          ? 'executing'
          : 'exploring',
    })
    repo.append(run.sessionId, run.id, 'tool.started', name, { toolCallId: id })
  }
  private async authorizeTool(
    id: string,
    tool: Tool,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    this.check()
    const { run, project, approvals, abort, update } = this.input
    const policy = evaluateToolPolicy({
      mode: run.mode,
      risk: tool.risk,
      permissionMode: this.input.repo.get('run', run.id).permissionMode,
    })
    if (policy.decision === 'deny') throw new Error(policy.code)
    if (tool.risk === 'read') return
    if (policy.decision === 'ask') update({ status: 'awaiting_approval' })
    const allowed = await approvals.request(
      {
        runId: run.id,
        sessionId: run.sessionId,
        toolCallId: id,
        action: 'mcp',
        parameters: approvalBinding(tool, args, run.capabilitySnapshot),
        command: `MCP ${tool.serverId} / ${tool.originalName}`,
        cwd: project.path,
      },
      signal ?? abort.signal,
      policy.decision === 'allow',
    )
    this.check()
    update({ status: 'running' })
    if (!allowed) throw new Error('APPROVAL_DENIED')
  }
  private async authorizeWrite(
    id: string,
    path: string,
    content: string,
    expectedHash: string | null,
  ): Promise<void> {
    this.check()
    if (this.input.run.mode !== 'develop') throw new Error('READ_ONLY_MODE')
    if (
      !/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|(?:^|\/)test_[^/]+|\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:package\.json|pyproject\.toml|.*lock|[^/]*config[^/]*)$/i.test(
        path,
      )
    )
      return
    const { run, project, approvals, abort, update } = this.input
    const trusted = this.input.repo.get('run', run.id).permissionMode === 'full'
    if (!trusted) update({ status: 'awaiting_approval' })
    const allowed = await approvals.request(
      {
        runId: run.id,
        sessionId: run.sessionId,
        toolCallId: id,
        action: 'file_write',
        parameters: { path, content, expectedHash },
        command: `修改测试或验证配置：${path}`,
        cwd: project.path,
      },
      abort.signal,
      trusted,
    )
    if (abort.signal.aborted) throw new Error('CANCELLED')
    update({ status: 'running' })
    if (!allowed) throw new Error('APPROVAL_DENIED')
  }
}
