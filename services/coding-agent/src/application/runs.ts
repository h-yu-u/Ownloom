import type { RpcParamsMap } from '../protocol/generated/types.js'
import { submittedSession, type Submission } from './run-submission.js'
import { saveTranscript, closeTranscript } from './transcript-lifecycle.js'
import { freezeInstructions } from './run-instructions.js'
import { freezeVerificationPlan } from './verification-plan.js'
import { RunCommands } from './run-commands.js'
import { subscribeRun } from './run-events.js'
import { RunReservations } from './run-reservations.js'
import type { ActiveCapability } from './ports.js'
import { canonical } from '../extensions/domain/types.js'
import { RunPolicy } from './run-policy.js'
import type { PiSession, Provider, RepositoryPort, RunPorts } from './ports.js'
import { promptAndVerify, finalizeRun } from './run-verification.js'
import { randomUUID } from 'node:crypto'
import { terminal, nextStatus, type Run, type Project, type Session } from '../domain/types.js'
import { defaultSettings } from '../domain/settings.js'
import { Approvals } from './approvals.js'
export class Runs {
  private reservations: RunReservations<Submission>
  private current:
    | { id: string; abort: AbortController; pi?: PiSession; task: Promise<void> }
    | undefined
  private approvals: Approvals
  private commands: RunCommands
  constructor(
    private repo: RepositoryPort,
    private ports: RunPorts,
  ) {
    this.approvals = new Approvals(repo)
    this.commands = new RunCommands({
      repo,
      ports,
      approvals: this.approvals,
      update: (id, patch) => this.update(id, patch),
    })
    this.reservations = new RunReservations((id) => {
      void this.cancel(id)
    })
  }
  async submit(input: Submission, deferred = false): Promise<Run> {
    const previous = this.repo.findSubmission(input.sessionId, input.submissionId)
    if (previous) {
      if (
        previous.text !== input.text ||
        previous.modelId !== input.provider.modelId ||
        previous.mode !== input.mode ||
        (previous.initialPermissionMode ?? previous.permissionMode ?? 'ask') !==
          (input.permissionMode ?? 'ask') ||
        (previous.verifyAfter !== undefined &&
          previous.verifyAfter !== (input.verifyAfter === true)) ||
        canonical(previous.selection) !== canonical(input.selection)
      )
        throw new Error('IDEMPOTENCY_CONFLICT')
      return previous
    }
    if (input.permissionMode === 'full' && input.mode !== 'develop')
      throw new Error('READ_ONLY_MODE')
    this.reservations.check(input.queue === true)
    const session = this.repo.get('session', input.sessionId)
    if (session.archived) throw new Error('SESSION_ARCHIVED')
    const project = this.repo.get('project', session.projectId)
    const snapshot =
      !input.probe && !input.verifyOnly
        ? this.ports.extensions?.resolve(
            { workspace: 'coding', kind: 'project', scopeId: project.id },
            input.selection,
            input.mode,
            input.provider.contextWindow,
          ).snapshot
        : undefined
    const run: Run = {
      ...(input.probe ? { probe: true } : {}),
      ...(input.verifyOnly ? { verifyOnly: true } : {}),
      ...(snapshot ? { capabilitySnapshot: snapshot } : {}),
      ...(input.selection ? { selection: input.selection } : {}),
      id: randomUUID(),
      sessionId: session.id,
      submissionId: input.submissionId,
      text: input.text,
      modelId: input.provider.modelId,
      mode: input.mode,
      permissionMode: input.permissionMode ?? 'ask',
      initialPermissionMode: input.permissionMode ?? 'ask',
      status: this.reservations.busy ? 'queued' : 'starting',
      phase: 'exploring',
      verification: 'not_run',
      verifyAfter: input.verifyAfter === true,
      verificationCommands:
        input.probe || input.verifyOnly || input.verifyAfter ? [...project.commands] : [],
      error: null,
      createdAt: new Date().toISOString(),
      baseline: '',
      fingerprint: null,
      maxRepairRounds: (this.repo.find('settings', 'coding') ?? defaultSettings).maxRepairRounds,
    }
    // Reservation occurs before the first asynchronous execution boundary.
    this.repo.startRun(run, submittedSession(session, input))
    this.reservations.add(run.id, input, !deferred)
    this.advance()
    return run
  }
  commit(input: RpcParamsMap['runs.commit']): Run {
    const run = this.repo.get('run', input.id)
    if (terminal(run.status)) return run
    this.reservations.commit(input.id, (submission) => ({
      ...submission,
      runtime: { bootstrapToken: input.bootstrapToken, capabilityUrl: input.capabilityUrl },
      connectionSecrets: input.connectionSecrets,
    }))
    this.advance()
    return run
  }
  private advance(): void {
    const next = this.reservations.next()
    if (next) this.start(next.id, next.input)
  }
  private start(id: string, input: Submission): void {
    const abort = new AbortController()
    const task = Promise.resolve().then(() => this.execute(id, input, abort))
    this.current = { id, abort, task }
  }
  private update(id: string, patch: Partial<Run>): Run {
    const previous = this.repo.get('run', id)
    const status = patch.status ? nextStatus(previous.status, patch.status) : previous.status
    return this.repo.save('run', { ...previous, ...patch, status }, 'run.updated')
  }
  private async execute(id: string, input: Submission, abort: AbortController): Promise<void> {
    const { probe = false, verifyOnly = false } = input
    let provider = input.provider,
      capability: ActiveCapability | undefined
    let run = this.repo.get('run', id)
    const session = this.repo.get('session', run.sessionId),
      project = this.repo.get('project', session.projectId)
    let opened: Awaited<ReturnType<RunPorts['open']>> | undefined
    const timer = setTimeout(() => abort.abort(), 20 * 60 * 1000)
    try {
      if (input.runtime && this.ports.activate) {
        capability = await this.ports.activate(input.runtime, abort.signal)
        provider = { ...provider, token: capability.token }
      }
      this.update(id, {
        status: 'starting',
        baseline: project.git ? await this.ports.gitStatus(project.path) : '',
      })
      const connectionSecrets: Record<string, Record<string, string>> = {}
      for (const server of run.capabilitySnapshot?.servers ?? []) {
        const secret = input.connectionSecrets?.[server.id]
        if (
          Object.keys(server.transport.secretRefs).length &&
          (!secret || secret.revision !== server.revision || secret.digest !== server.digest)
        )
          throw new Error('MCP_CONFIG_CHANGED')
        if (secret) connectionSecrets[server.id] = secret.values
      }
      run = this.update(id, {
        verificationPlan: await freezeVerificationPlan(this.ports, run, project),
      })
      opened = await this.prepare({
        run,
        project,
        session,
        provider,
        abort,
        probe,
        connectionSecrets,
        capability,
      })
      await saveTranscript({
        repo: this.repo,
        kind: 'session',
        sessionId: session.id,
        runId: id,
        opened,
      })
      const pi = opened.session
      if (this.current?.id === id) this.current.pi = pi
      const stop = (): void => {
        void pi.abort()
      }
      abort.signal.addEventListener('abort', stop, { once: true })
      if (abort.signal.aborted) throw new Error('CANCELLED')
      subscribeRun(pi, this.repo, id, (patch) => {
        this.update(id, patch)
      })
      this.update(id, { status: 'running', phase: 'generating' })
      await promptAndVerify({
        pi,
        run,
        project,
        abort,
        probe,
        verifyOnly,
        command: (callId, command, signal, probe) =>
          this.commands.execute(id, callId, command, signal, probe, true),
        checks: () => this.repo.checksForRun(id).slice(-(run.verificationCommands?.length ?? 0)),
      })
      await saveTranscript({
        repo: this.repo,
        kind: 'session',
        sessionId: session.id,
        runId: id,
        opened,
      })
      this.update(
        id,
        await finalizeRun({ repo: this.repo, ports: this.ports, run, root: project.path }),
      )
      abort.signal.removeEventListener('abort', stop)
    } catch (error) {
      const cancelled = abort.signal.aborted || this.repo.get('run', id).status === 'cancelling'
      this.update(id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled
          ? 'CANCELLED'
          : error instanceof Error
            ? error.message.slice(0, 200)
            : 'CODING_FAILED',
      })
    } finally {
      clearTimeout(timer)
      this.approvals.denyRun(id)
      try {
        if (opened)
          await closeTranscript({
            repo: this.repo,
            kind: 'session',
            sessionId: session.id,
            runId: id,
            opened,
          })
      } finally {
        try {
          if (input.runtime) await this.ports.closeCapability?.(input.runtime, capability)
        } catch {
          this.repo.append(session.id, id, 'run.cleanup_failed', 'CAPABILITY_CLOSE_FAILED')
        }
        if (this.current?.id === id) this.current = undefined
        this.reservations.finish(id)
        this.advance()
      }
    }
  }
  private async prepare(input: {
    run: Run
    project: Project
    session: Session
    provider: Provider
    abort: AbortController
    probe: boolean
    capability?: ActiveCapability
    connectionSecrets: Record<string, Record<string, string>>
  }): Promise<Awaited<ReturnType<RunPorts['open']>>> {
    const { run, session, provider, abort, probe } = input,
      id = run.id
    const project = await freezeInstructions({
      repo: this.repo,
      ports: this.ports,
      run,
      project: input.project,
    })
    const context = new RunPolicy({
      repo: this.repo,
      ports: this.ports,
      run,
      project,
      abort,
      approvals: this.approvals,
      update: (patch) => {
        this.update(id, patch)
      },
      command: (callId, command, signal) =>
        this.commands.execute(id, callId, command, signal ?? abort.signal, probe),
    }).context()
    let skillInstructions = ''
    for (const skill of run.capabilitySnapshot?.skills ?? []) {
      const body = (await this.ports.extensions?.read(skill, 'SKILL.md')) ?? ''
      skillInstructions += `\nSkill ${skill.id}, revision ${skill.revision}:\n${body}\n`
      this.repo.append(session.id, id, 'skill.loaded', skill.name, {
        skillId: skill.id,
        revision: skill.revision,
        digest: skill.digest,
        bytes: body.length,
      })
    }
    return this.ports.open({
      capability: input.capability,
      snapshot: run.capabilitySnapshot,
      skillInstructions,
      connectionSecrets: input.connectionSecrets,
      directory: this.repo.directory,
      project,
      session,
      provider,
      context,
    })
  }
  resolve(id: string, allowed: boolean): void {
    this.approvals.resolve(id, allowed)
  }
  setPermissions(id: string, permissionMode: 'ask' | 'full'): Run {
    return this.approvals.setPermissions(id, permissionMode)
  }
  async cancel(id: string): Promise<Run> {
    const run = this.repo.get('run', id)
    if (terminal(run.status)) return run
    if (this.reservations.remove(id)) {
      const cancelled = this.update(id, { status: 'cancelled' })
      this.advance()
      return cancelled
    }
    if (run.status !== 'cancelling') this.update(id, { status: 'cancelling' })
    if (this.current?.id === id) {
      this.current.abort.abort()
      await this.current.task
    }
    return this.repo.get('run', id)
  }
  async steer(id: string, text: string): Promise<void> {
    if (
      this.current?.id !== id ||
      !this.current.pi ||
      this.repo.get('run', id).status === 'cancelling'
    )
      throw new Error('RUN_NOT_READY')
    await this.current.pi.steer(text)
    this.repo.append(this.repo.get('run', id).sessionId, id, 'user.steering', text)
  }
  async wait(id: string): Promise<void> {
    if (this.current?.id === id) await this.current.task
  }
  async revoke(targetId: string): Promise<void> {
    const affected = this.repo
      .list('run')
      .filter(
        (run) =>
          !terminal(run.status) &&
          [
            ...(run.capabilitySnapshot?.skills ?? []),
            ...(run.capabilitySnapshot?.servers ?? []),
          ].some((item) => item.id === targetId),
      )
    for (const run of affected) await this.cancel(run.id)
  }
  async close(): Promise<void> {
    for (const id of this.reservations.stop()) await this.cancel(id)
    if (this.current) await this.cancel(this.current.id)
    this.ports.commands.close()
  }
}
