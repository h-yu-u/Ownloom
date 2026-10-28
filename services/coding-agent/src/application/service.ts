import type { AgentChat } from './agent-chat.js'
import type { Extensions } from '../extensions/application/service.js'
import type { Selection } from '../extensions/domain/types.js'
import type { RpcParamsMap as Params } from '../protocol/generated/types.js'
import { rpcMethod, validateRpc } from '../protocol/validation.js'
import type { RpcMethod, RpcParamsMap, RpcResultMap } from '../protocol/generated/types.js'
import { localProvider } from './local-provider.js'
import { defaultSettings, validateSettings } from '../domain/settings.js'
import type { ServiceRepository } from './repository-ports.js'
import type { ProjectSessions } from './project-sessions.js'
import type { ChangeService } from './changes.js'
import type { CapabilityVerifier } from './capability-verifier.js'
import { object, string, mode } from '../domain/types.js'
import { Runs } from './runs.js'
import { taskSummaries } from './task-summaries.js'
import { DataAdmission, readMethods } from './data-admission.js'
export class CodingService {
  constructor(
    readonly repo: ServiceRepository,
    private runs: Runs,
    private sessions: ProjectSessions,
    changes: ChangeService,
    private verifier: CapabilityVerifier,
    private extensions?: Extensions,
    private agent?: AgentChat,
    private closeAgentRepository?: () => void,
    private backup?: () => Promise<{ directory: string }>,
    private restoreProfile?: (id: string) => Promise<{ imported: boolean }>,
  ) {
    this.handlers = { ...this.handlers, ...sessions.handlers, ...changes.handlers }
  }
  private admission = new DataAdmission()
  private handlers: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
    'data.restore.profile': async (p) => {
      if (this.runs.busy || this.repo.active() || this.agent?.busy || this.extensions?.busy)
        throw new Error('BACKUP_BUSY')
      if (!this.restoreProfile) throw new Error('RESTORE_NOT_AVAILABLE')
      return this.restoreProfile(string(p.identifier))
    },
    'data.export': async () => {
      if (this.runs.busy || this.repo.active() || this.agent?.busy || this.extensions?.busy)
        throw new Error('BACKUP_BUSY')
      if (!this.backup) throw new Error('BACKUP_NOT_AVAILABLE')
      return this.backup()
    },
    'tasks.list': async () => [
      ...taskSummaries(this.repo, 'coding'),
      ...(((await this.agent?.dispatch('agent.tasks.list', {})) as unknown[]) ?? []),
    ],
    'settings.get': async (p) => {
      return this.repo.find('settings', 'coding') ?? defaultSettings
    },
    'settings.update': async (p) => {
      {
        if (this.repo.active()) throw new Error('CODING_BUSY')
        return this.repo.save('settings', validateSettings(p))
      }
    },
    'runs.submit': async (p) => this.submit(p, false),
    'runs.prepare': async (p) => this.submit(p, true),
    'runs.permissions': async (p) =>
      this.runs.setPermissions(string(p.id), (p as Params['runs.permissions']).permissionMode),
    'runs.commit': async (p) => this.runs.commit(p as Params['runs.commit']),
    'sessions.verify': async (p) => {
      {
        if (this.agent?.busy) throw new Error('CODING_BUSY')
        const provider = localProvider(p),
          id = string(p.sessionId)
        const project = this.repo.get('project', this.repo.get('session', id).projectId)
        if (!project.commands.length) throw new Error('VERIFICATION_COMMANDS_REQUIRED')
        return this.runs.submit({
          sessionId: id,
          submissionId: string(p.submissionId),
          text: '运行项目配置的验证命令',
          mode: 'develop',
          provider,
          verifyOnly: true,
        })
      }
    },
    'runs.cancel-active': async () => {
      const active = this.repo.active()
      return active ? this.runs.cancel(active.id) : { cancelled: false }
    },
    'runs.cancel': async (p) => {
      return this.runs.cancel(string(p.id))
    },
    'runs.steer': async (p) => {
      await this.runs.steer(string(p.id), string(p.text, 16000))
      return { accepted: true }
    },
    'approvals.resolve': async (p) => {
      {
        if (typeof p.allowed !== 'boolean') throw new Error('INVALID_APPROVAL')
        this.runs.resolve(string(p.id), p.allowed)
        return { resolved: true }
      }
    },
    'events.wait': async (p) => this.repo.waitEvents(typeof p.after === 'number' ? p.after : 0),
    'events.list': async (p) => {
      return {
        events: this.repo.events(typeof p.after === 'number' ? p.after : 0),
        watermark: this.repo.watermark(),
      }
    },
    'capabilities.list': async (p) => {
      return this.repo.list('capability')
    },
    'capabilities.verify': async (p) => {
      return this.verifier.verify(localProvider(p))
    },
    shutdown: async (p) => {
      await this.close()
      return { closed: true }
    },
  }
  private async submit(p: Record<string, unknown>, deferred: boolean) {
    {
      const previous = this.repo.findSubmission(string(p.sessionId), string(p.submissionId))
      if (!previous && this.agent?.busy) throw new Error('CODING_BUSY')
      const provider = localProvider(p)
      provider.contextWindow = Math.min(
        provider.contextWindow,
        (this.repo.find('settings', 'coding') ?? defaultSettings).contextBudget,
      )
      if (
        !previous &&
        !(() => {
          const capability = this.repo.find('capability', provider.modelId)
          return (
            capability?.status === 'verified' &&
            capability.modelFingerprint === provider.fingerprint
          )
        })()
      )
        throw new Error('MODEL_TOOLS_UNVERIFIED')
      return this.runs.submit(
        {
          sessionId: string(p.sessionId),
          submissionId: string(p.submissionId),
          text: string(p.text, 32000),
          mode: mode(p.mode),
          permissionMode: (p.permissionMode as 'ask' | 'full' | undefined) ?? 'ask',
          provider,
          queue: p.queue === true,
          verifyAfter: p.verifyAfter === true,
          selection: p.selection as Selection | undefined,
          connectionSecrets: p.connectionSecrets as Params['runs.submit']['connectionSecrets'],
        },
        deferred,
      )
    }
  }
  async dispatch<M extends RpcMethod>(method: M, raw: RpcParamsMap[M]): Promise<RpcResultMap[M]> {
    await this.extensions?.ready
    const key = rpcMethod(method)
    validateRpc(key, 'params', raw)
    const handler =
      key.startsWith('agent.') && this.agent
        ? (params: Record<string, unknown>) => this.agent!.dispatch(key, params)
        : key.startsWith('extensions.') && this.extensions
          ? (params: Record<string, unknown>) => this.extensions!.dispatch(key, params)
          : this.handlers[key]
    if (!handler) throw new Error('UNKNOWN_METHOD')
    const action = () => handler(object(raw))
    const result: unknown = await (key === 'data.export' || key === 'data.restore.profile'
      ? this.admission.exclusive(action)
      : readMethods.has(key)
        ? action()
        : this.admission.run(action))
    validateRpc(key, 'result', result)
    return result as RpcResultMap[M]
  }

  private closing?: Promise<void>
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      try {
        await this.runs.close()
        await this.agent?.close()
        this.closeAgentRepository?.()
        await this.extensions?.close()
      } finally {
        this.sessions.close()
      }
    })())
  }
}
