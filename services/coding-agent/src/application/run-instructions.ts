import { createHash } from 'node:crypto'
import type { Project, Run } from '../domain/types.js'
import type { RunPorts } from './ports.js'
import type { InstructionRepository } from './repository-ports.js'

export async function freezeInstructions(input: {
  repo: InstructionRepository
  ports: RunPorts
  run: Run
  project: Project
}): Promise<Project> {
  const { ports, project, repo, run } = input
  const content = ports.instructions ? await ports.instructions(project.path) : project.instructions
  const digest = createHash('sha256')
    .update(content ?? '')
    .digest('hex')
  const id = createHash('sha256')
    .update(project.path + digest)
    .digest('hex')
  if (!repo.find('instructions', id))
    repo.save('instructions', {
      id,
      path: 'AGENTS.md',
      digest,
      content: content ?? '',
      scope: project.path,
    })
  repo.append(run.sessionId, run.id, 'instructions.frozen', '', {
    id,
    path: 'AGENTS.md',
    digest,
    scope: project.path,
  })
  return { ...project, instructions: content }
}
