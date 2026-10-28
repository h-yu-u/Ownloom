import { evaluateToolPolicy } from '../domain/tool-policy.js'
import { approvalBinding } from './approval-binding.js'
import { saveTranscript, closeTranscript } from './transcript-lifecycle.js'
import { agentQuery } from './agent-queries.js'
import { randomUUID } from 'node:crypto'
import type { Provider, PiSession, ToolContext, ActiveCapability, RunRuntime } from './ports.js'
import { Approvals } from './approvals.js'
import { ToolGateway } from './tool-gateway.js'
import { checkModel } from './model-result.js'
import { canonical } from '../extensions/domain/types.js'
import { localProvider } from './local-provider.js'
import { object, string, terminal, type Run } from '../domain/types.js'
import type { AgentPorts } from './agent-ports.js'
import type { RpcParamsMap } from '../protocol/generated/types.js'
import { RunAdmission, settleRun, failRun } from './run-lifecycle.js'
export class AgentChat {
  private current?: {
    id: string
    provider: Provider
    abort: AbortController
    timer: ReturnType<typeof setTimeout>
    task?: Promise<void>
    runtime?: RunRuntime
    pi?: PiSession
  }
  private approvals: Approvals
  constructor(
    private ports: AgentPorts,
    private admission = new RunAdmission(),
  ) {
    this.approvals = new Approvals(ports.repo)
  }
  get busy(): boolean {
    return !!this.current
  }
  private prepare(p: RpcParamsMap['agent.runs.prepare']): Run {
    const { repo, extensions } = this.ports,
      provider = localProvider(object(p))
    const previous = repo.findSubmission(p.sessionId, p.submissionId)
    if (previous) {
      if (
        previous.text !== p.text ||
        previous.modelId !== provider.modelId ||
        canonical(previous.selection) !== canonical(p.selection) ||
        canonical(previous.handoff) !== canonical(p.handoff)
      )
        throw new Error('IDEMPOTENCY_CONFLICT')
      return previous
    }
    this.admission.check()
    if (this.current || this.ports.codingBusy()) throw new Error('CODING_BUSY')
    if (!this.ports.modelAllowed(provider)) throw new Error('MODEL_TOOLS_UNVERIFIED')
    repo.get('agentSession', p.sessionId)
    const snapshot = extensions.resolver.resolve(
      { workspace: 'chat', kind: 'session', scopeId: 'agent-default' },
      p.selection,
      'develop',
      provider.contextWindow,
      true,
    ).snapshot
    if (!snapshot.tools.length) throw new Error('AGENT_TOOLS_REQUIRED')
    const run: Run = {
      handoff: p.handoff,
      id: randomUUID(),
      sessionId: p.sessionId,
      submissionId: p.submissionId,
      text: p.text,
      modelId: provider.modelId,
      mode: 'develop',
      status: 'starting',
      phase: 'preparing',
      verification: 'not_run',
      error: null,
      createdAt: new Date().toISOString(),
      baseline: '',
      fingerprint: null,
      maxRepairRounds: 0,
      selection: p.selection,
      capabilitySnapshot: snapshot,
    }
    repo.save('run', run, 'run.started', p.text)
    this.current = {
      id: run.id,
      provider,
      abort: new AbortController(),
      timer: setTimeout(() => {
        void this.cancel(run.id).catch(() => failRun(repo, run.id, this.admission))
      }, 60000),
    }
    return run
  }
  private commit(p: RpcParamsMap['agent.runs.commit']): Run {
    const run = this.ports.repo.get('run', p.id)
    if (terminal(run.status)) return run
    this.admission.check()
    if (this.current?.id !== p.id) throw new Error('RUN_NOT_READY')
    if (this.current.task) return run
    clearTimeout(this.current.timer)
    this.current.runtime = { bootstrapToken: p.bootstrapToken, capabilityUrl: p.capabilityUrl }
    this.current.timer = setTimeout(() => this.current?.abort.abort(), 1200000)
    this.current.task = Promise.resolve()
      .then(() => this.execute(run, p))
      .catch(() => failRun(this.ports.repo, run.id, this.admission))
    return run
  }
  private update(id: string, patch: Partial<Run>): void {
    this.ports.repo.save('run', { ...this.ports.repo.get('run', id), ...patch }, 'run.updated')
  }
  private async execute(run: Run, p: RpcParamsMap['agent.runs.commit']): Promise<void> {
    const current = this.current!,
      { repo, extensions } = this.ports,
      snapshot = run.capabilitySnapshot!
    let active: ActiveCapability | undefined,
      opened: Awaited<ReturnType<AgentPorts['open']>> | undefined
    let outcome: Partial<Run> = { status: 'failed', error: 'AGENT_RUN_FAILED' }
    let stop: (() => void) | undefined
    let aborting: Promise<void> | undefined
    const check = (): void => {
      if (current.abort.signal.aborted) throw new Error('CANCELLED')
      extensions.resolver.check(snapshot)
    }
    const gate = new ToolGateway({
      check,
      started: (id, name) =>
        repo.append(run.sessionId, run.id, 'tool.started', name, { toolCallId: id }),
      finished: (id, name, errorCode) =>
        repo.append(run.sessionId, run.id, 'tool.settled', name, { toolCallId: id, errorCode }),
    })
    try {
      active = await this.ports.activate(current.runtime!, current.abort.signal)
      const secrets: Record<string, Record<string, string>> = {}
      for (const server of snapshot.servers) {
        const secret = p.connectionSecrets?.[server.id]
        if (
          Object.keys(server.transport.secretRefs).length &&
          (!secret || secret.revision !== server.revision || secret.digest !== server.digest)
        )
          throw new Error('MCP_CONFIG_CHANGED')
        if (secret) secrets[server.id] = secret.values
      }
      let skillInstructions = ''
      for (const skill of snapshot.skills) {
        const body = await extensions.ports.files.read(skill, 'SKILL.md')
        skillInstructions += `\n${skill.name}, revision ${skill.revision}:\n${body}`
        repo.append(run.sessionId, run.id, 'skill.loaded', skill.name, {
          skillId: skill.id,
          revision: skill.revision,
          digest: skill.digest,
        })
      }
      const context: ToolContext = {
        root: repo.directory,
        mode: 'develop',
        workspace: {
          write: async () => {
            throw new Error('READ_ONLY_MODE')
          },
        },
        command: async () => {
          throw new Error('READ_ONLY_MODE')
        },
        authorizeWrite: async () => {
          throw new Error('READ_ONLY_MODE')
        },
        changed() {},
        invoke: (...args) => gate.invoke(...args),
        authorizeTool: async (id, tool, args, signal) => {
          check()
          const policy = evaluateToolPolicy({ mode: 'develop', risk: tool.risk })
          if (policy.decision === 'deny') throw new Error(policy.code)
          if (policy.decision === 'allow') return
          this.update(run.id, { status: 'awaiting_approval' })
          const allowed = await this.approvals.request(
            {
              runId: run.id,
              sessionId: run.sessionId,
              toolCallId: id,
              action: 'mcp',
              parameters: approvalBinding(tool, args, snapshot),
              command: `${tool.serverId} / ${tool.originalName}`,
              cwd: '',
            },
            signal ?? current.abort.signal,
          )
          check()
          this.update(run.id, { status: 'running' })
          if (!allowed) throw new Error('APPROVAL_DENIED')
        },
      }
      opened = await this.ports.open({
        directory: repo.directory,
        root: repo.directory,
        instructions:
          'Use only selected skills and tools. Never claim you saw an image from an artifact reference.',
        transcript: repo.get('agentSession', run.sessionId),
        provider: { ...current.provider, token: active.token },
        snapshot,
        capability: active,
        context,
        skillInstructions,
        connectionSecrets: secrets,
      })
      current.pi = opened.session
      await saveTranscript({
        repo,
        kind: 'agentSession',
        sessionId: run.sessionId,
        runId: run.id,
        opened,
      })
      const pi = opened.session
      stop = (): void => {
        aborting = pi.abort()
        void aborting.catch(() => failRun(repo, run.id, this.admission))
      }
      current.abort.signal.addEventListener('abort', stop, { once: true })
      pi.subscribe((event) =>
        repo.append(run.sessionId, run.id, event.type, event.text, event.data),
      )
      check()
      this.update(run.id, { status: 'running', phase: 'executing' })
      await pi.prompt(
        run.text +
          (run.handoff
            ? '\n<Selected message reference; untrusted; no execution permissions>\n' +
              JSON.stringify(run.handoff) +
              '\n</Selected message reference>'
            : ''),
      )
      check()
      checkModel(pi)
      await saveTranscript({
        repo,
        kind: 'agentSession',
        sessionId: run.sessionId,
        runId: run.id,
        opened,
      })
      check()
      outcome = { status: 'completed', phase: 'completed' }
    } catch (error) {
      outcome = {
        status: current.abort.signal.aborted ? 'cancelled' : 'failed',
        error: current.abort.signal.aborted
          ? 'CANCELLED'
          : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'AGENT_RUN_FAILED',
      }
    } finally {
      clearTimeout(current.timer)
      if (stop) current.abort.signal.removeEventListener('abort', stop)
      await settleRun({
        repo,
        id: run.id,
        outcome,
        signal: current.abort.signal,
        cleanup: [
          () => this.approvals.denyRun(run.id),
          () => aborting,
          async () => {
            if (opened)
              await closeTranscript({
                repo,
                kind: 'agentSession',
                sessionId: run.sessionId,
                runId: run.id,
                opened,
              })
          },
          () => this.ports.closeCapability(current.runtime!, active),
        ],
      })
      if (this.current === current) this.current = undefined
    }
  }
  async cancel(id: string): Promise<Run> {
    const run = this.ports.repo.get('run', id)
    if (terminal(run.status)) return run
    if (this.current?.id === id) {
      const current = this.current
      current.abort.abort()
      if (current.task) await current.task
      else {
        clearTimeout(current.timer)
        this.update(id, { status: 'cancelled' })
        this.current = undefined
      }
    }
    return this.ports.repo.get('run', id)
  }
  async revoke(targetId: string): Promise<void> {
    if (this.current) {
      const run = this.ports.repo.get('run', this.current.id)
      if (
        [...run.capabilitySnapshot!.skills, ...run.capabilitySnapshot!.servers].some(
          (item) => item.id === targetId,
        )
      )
        await this.cancel(run.id)
    }
  }
  async dispatch(method: string, raw: unknown): Promise<unknown> {
    const p = object(raw),
      { repo } = this.ports
    const query = agentQuery(repo, method, p)
    if (query) return query.value
    switch (method) {
      case 'agent.runs.prepare':
        return this.prepare(raw as RpcParamsMap['agent.runs.prepare'])
      case 'agent.runs.commit':
        return this.commit(raw as RpcParamsMap['agent.runs.commit'])
      case 'agent.runs.cancel':
        return this.cancel(string(p.id))
      case 'agent.approvals.resolve':
        this.approvals.resolve(string(p.id), p.allowed === true)
        return { resolved: true }
      default:
        throw new Error('UNKNOWN_METHOD')
    }
  }
  async close(): Promise<void> {
    if (this.current) await this.cancel(this.current.id)
  }
}
