import { verificationManifest } from './adapters/verification-manifest.js'
import { restoreData } from './adapters/data-restore.js'
import { exportData } from './adapters/data-export.js'
import { fileURLToPath } from 'node:url'
import { AgentChat } from './application/agent-chat.js'
import { activateCapability, closeCapability } from './adapters/extensions/capability-client.js'
import { Extensions } from './extensions/application/service.js'
import { ExtensionsRepository } from './adapters/extensions/repository.js'
import { ManagedSkillFiles, digest } from './adapters/extensions/skill-files.js'
import { McpConnections } from './adapters/extensions/transport.js'
import { join } from 'node:path'
import { ProjectSessions } from './application/project-sessions.js'
import { ChangeService } from './application/changes.js'
import { CapabilityVerifier } from './application/capability-verifier.js'
import { projectWorkspace } from './adapters/project-workspace.js'
import { Repository } from './adapters/repository.js'
import { Commands } from './adapters/commands.js'
import { git, instructions, Workspace } from './adapters/workspace.js'
import { openPi } from './adapters/pi-session.js'
import { Runs } from './application/runs.js'
import { CodingService } from './application/service.js'
import { RunAdmission } from './application/run-lifecycle.js'
export function createCodingService(
  repo: Repository,
  processEvent?: (pid: number, state: 'start' | 'end') => void,
): CodingService {
  const extensionRepo = new ExtensionsRepository(repo.directory)
  const files = new ManagedSkillFiles(join(repo.directory, 'skills'))
  const extensions: Extensions = new Extensions({
    repo: extensionRepo,
    builtinSkills: ['studio-image-prompts', 'studio-spoken-draft'].map((name) => ({
      id: `builtin_${name}`,
      path: fileURLToPath(new URL(`../resources/skills/${name}`, import.meta.url)),
      workspaces:
        name === 'studio-image-prompts' ? ['image', 'coding', 'chat'] : ['audio', 'coding', 'chat'],
    })),
    files,
    mcp: new McpConnections(processEvent),
    digest,
    revokeRuns: async (id): Promise<void> => {
      await runs.revoke(id)
      await agent.revoke(id)
    },
  })
  const resources = {
    resolve: extensions.resolver.resolve.bind(extensions.resolver),
    read: files.read.bind(files),
    check: extensions.resolver.check.bind(extensions.resolver),
  }
  const admission = new RunAdmission()
  const checkAdmission = () => admission.check()
  const projects = projectWorkspace(repo)
  const runs: Runs = new Runs(
    repo,
    {
      extensions: resources,
      activate: activateCapability,
      closeCapability,
      commands: new Commands(processEvent),
      fingerprint: projects.fingerprint,
      instructions,
      verificationManifest,
      gitStatus: (root) => git(root, 'status'),
      workspace: (root, run) => new Workspace(repo, root, run),
      open: (input) => openPi({ ...input, extensions: resources, processEvent }),
    },
    admission,
  )
  const agentRepo = new Repository(join(repo.directory, 'agent-chat'), 'agent-chat.db')
  const agent = new AgentChat(
    {
      repo: agentRepo,
      extensions,
      codingBusy: () => runs.busy,
      modelAllowed: (provider) => {
        const capability = repo.find('capability', provider.modelId)
        return (
          capability?.status === 'verified' && capability.modelFingerprint === provider.fingerprint
        )
      },
      activate: activateCapability,
      closeCapability,
      open: (input) => openPi({ ...input, workspace: 'chat', extensions: resources, processEvent }),
    },
    admission,
  )
  return new CodingService(
    repo,
    runs,
    new ProjectSessions(repo, projects, checkAdmission),
    new ChangeService(repo, projects, checkAdmission),
    new CapabilityVerifier(repo, runs, projects, checkAdmission),
    extensions,
    agent,
    () => agentRepo.close(),
    () => exportData(repo, agentRepo, extensionRepo),
    restoreData,
  )
}
