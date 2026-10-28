import { freezeInstructions } from './run-instructions.js'
import { RunPolicy } from './run-policy.js'
import type { ActiveCapability, Provider, RunPorts, ToolContext } from './ports.js'
import type { PreparationRepository } from './repository-ports.js'
import type { Run, Project, Session } from '../domain/types.js'
import type { Approvals } from './approvals.js'

interface Preparation {
  repo: PreparationRepository
  ports: RunPorts
  approvals: Approvals
  run: Run
  project: Project
  session: Session
  provider: Provider
  abort: AbortController
  capability?: ActiveCapability
  connectionSecrets: Record<string, Record<string, string>>
  update(patch: Partial<Run>): void
  command: ToolContext['command']
}

/** Freeze project/skill input before opening the single owned Pi session. */
export async function prepareRun(
  input: Preparation,
): Promise<Awaited<ReturnType<RunPorts['open']>>> {
  const { run, session, provider, abort, repo, ports, approvals, update, command } = input
  const project = await freezeInstructions({ repo, ports, run, project: input.project })
  const context = new RunPolicy({
    repo,
    ports,
    run,
    project,
    abort,
    approvals,
    update,
    command,
  }).context()
  let skillInstructions = ''
  for (const skill of run.capabilitySnapshot?.skills ?? []) {
    const body = (await ports.extensions?.read(skill, 'SKILL.md')) ?? ''
    skillInstructions += `\nSkill ${skill.id}, revision ${skill.revision}:\n${body}\n`
    repo.append(session.id, run.id, 'skill.loaded', skill.name, {
      skillId: skill.id,
      revision: skill.revision,
      digest: skill.digest,
      bytes: body.length,
    })
  }
  return ports.open({
    capability: input.capability,
    snapshot: run.capabilitySnapshot,
    skillInstructions,
    connectionSecrets: input.connectionSecrets,
    directory: repo.directory,
    project,
    session,
    provider,
    context,
  })
}
