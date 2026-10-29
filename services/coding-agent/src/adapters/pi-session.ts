import { createPiEventBridge } from './pi-events.js'
import { providerErrorCode } from '../application/model-result.js'
import { contextSettings } from '../domain/context-budget.js'
import { checkpoint, validateTranscript } from './transcript.js'
import { builtinDefinitions } from './extensions/builtin-tools.js'
import type { ActiveCapability } from '../application/ports.js'
import type { RunExtensions } from '../extensions/application/ports.js'
import type { Snapshot } from '../extensions/domain/types.js'
import { mcpResources } from './extensions/pi-mcp.js'
import { skillTool } from './extensions/skill-tool.js'
import { tools } from './tools.js'
import { piSystemPrompt } from './pi-prompt.js'
import { codingStream } from './coding-provider.js'
import type { Provider, ToolContext, PiSession } from '../application/ports.js'
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent'
import { join } from 'node:path'
import { mkdir, readdir } from 'node:fs/promises'
import type { Project, Session } from '../domain/types.js'
type PiInput = {
  directory: string
  provider: Provider
  context: ToolContext
  capability?: ActiveCapability
  snapshot?: Snapshot
  extensions?: RunExtensions
  skillInstructions?: string
  connectionSecrets?: Record<string, Record<string, string>>
  processEvent?: (pid: number, state: 'start' | 'end') => void
} & (
  | { workspace?: 'coding'; project: Project; session: Session }
  | {
      workspace: 'chat'
      root: string
      instructions: string
      transcript: Pick<Session, 'id' | 'piPath' | 'transcript'>
    }
)
export async function openPi(
  input: PiInput,
): Promise<{ session: PiSession; path: () => string | undefined }> {
  const cwd = input.workspace === 'chat' ? input.root : input.project.path
  const emptyWorkspace =
    input.workspace !== 'chat' &&
    input.context.mode === 'develop' &&
    (await readdir(cwd)).every((name) => name === '.git' || name === '.DS_Store')
  const instructions = input.workspace === 'chat' ? input.instructions : input.project.instructions
  const transcript = input.workspace === 'chat' ? input.transcript : input.session
  const budget = contextSettings(input.provider.contextWindow, input.workspace ?? 'coding')
  const agentDir = join(input.directory, 'pi')
  const sessionDir = join(agentDir, transcript.id)
  await mkdir(sessionDir, { recursive: true })
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'unused-auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  })
  runtime.registerProvider('mlx-studio', {
    name: 'Ownloom',
    baseUrl: input.provider.baseUrl,
    api: 'openai-completions',
    apiKey: input.provider.token,
    ...(input.workspace !== 'chat'
      ? { streamSimple: codingStream(input.provider.contextWindow) }
      : {}),
    models: [
      {
        id: input.provider.modelId,
        name: input.provider.modelId,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: input.provider.contextWindow,
        maxTokens: budget.output,
        compat: {
          supportsDeveloperRole: false,
          supportsStore: false,
          maxTokensField: 'max_tokens',
        },
      },
    ],
  })
  const model = runtime.getModel('mlx-studio', input.provider.modelId)
  if (!model) throw new Error('MODEL_NOT_FOUND')
  const settings = SettingsManager.inMemory({
    retry: { enabled: false },
    compaction: {
      enabled: true,
      reserveTokens: budget.reserveTokens,
      keepRecentTokens: budget.keepRecentTokens,
    },
    defaultThinkingLevel: 'off',
  })
  const mcp =
    input.snapshot?.servers.length && input.extensions
      ? await mcpResources({
          directory: agentDir,
          snapshot: input.snapshot,
          extensions: input.extensions,
          context: input.context,
          secrets: input.connectionSecrets ?? {},
          processEvent: input.processEvent,
        })
      : undefined
  const extensionRuntime = { extensions: [], errors: [], runtime: createExtensionRuntime() }
  const loader: ResourceLoader = {
    getExtensions: () => mcp?.loaded ?? extensionRuntime,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      piSystemPrompt({
        workspace: input.workspace ?? 'coding',
        mode: input.context.mode,
        instructions,
        skills: input.skillInstructions ?? '',
        emptyWorkspace,
      }),
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
  if (transcript.piPath) await validateTranscript(transcript.piPath, cwd, transcript.transcript)
  const manager = transcript.piPath
    ? SessionManager.open(transcript.piPath, sessionDir, cwd)
    : SessionManager.create(cwd, sessionDir)
  const appTools = input.workspace === 'chat' ? [] : tools(input.context)
  if (input.snapshot?.skills.length && input.extensions)
    appTools.push(skillTool(input.snapshot, input.extensions, input.context))
  if (input.snapshot && input.capability && input.extensions)
    appTools.push(
      ...builtinDefinitions(input.snapshot, input.capability, input.context, input.extensions),
    )
  const result = await createAgentSession({
    cwd: cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: loader,
    tools: [
      ...appTools.map((tool) => tool.name),
      ...(input.snapshot?.servers.map((server) => `mcp__${server.id}__*`) ?? []),
    ],
    customTools: appTools,
  })
  const pi = result.session
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> =>
    (closePromise ??= (async () => {
      try {
        await pi.abort()
        await pi.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
      } finally {
        await mcp?.close()
        pi.dispose()
      }
    })())
  try {
    await pi.bindExtensions({})
    await mcp?.wait()
  } catch (error) {
    await close()
    throw error
  }
  const session: PiSession = {
    prompt: async (text) => {
      input.snapshot && input.extensions?.check(input.snapshot)
      await pi.prompt(text, { expandPromptTemplates: false })
    },
    checkpoint: async () => ({
      ...(await checkpoint(manager, transcript.id)),
      sourceCwd: transcript.transcript?.sourceCwd,
      restoredCwd: transcript.transcript?.restoredCwd,
    }),
    compact: async () => {
      if (!pi.isIdle) throw new Error('SESSION_BUSY')
      await pi.compact()
    },
    contextUsage: () => pi.getContextUsage(),
    steer: (text) => pi.sendUserMessage(text, { deliverAs: 'steer', expandPromptTemplates: false }),
    abort: () => pi.abort(),
    close,
    lastStopReason: () => {
      const last = pi.messages.at(-1)
      return last?.role === 'assistant' ? last.stopReason : undefined
    },
    lastErrorCode: () => {
      const last = pi.messages.at(-1)
      return last?.role === 'assistant' ? providerErrorCode(last.errorMessage) : undefined
    },
    subscribe: (callback) => {
      pi.subscribe(createPiEventBridge(callback, input.snapshot, input.workspace !== 'chat'))
    },
  }
  return { session, path: () => manager.getSessionFile() }
}
