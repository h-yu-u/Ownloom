import type { ProjectPort } from './ports.js'
import type { ChangeRepository } from './repository-ports.js'
import { string } from '../domain/types.js'
export class ChangeService {
  constructor(
    private repo: ChangeRepository,
    private projects: ProjectPort,
  ) {}
  handlers: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
    'sessions.files': async (p) => {
      return { files: await this.projects.files(this.projectPath(string(p.id))) }
    },
    'sessions.read': async (p) =>
      this.projects.read(this.projectPath(string(p.id)), string(p.path)),
    'sessions.changes': async (p) => {
      {
        const id = string(p.id),
          root = this.projectPath(id),
          project = this.repo.get('project', this.repo.get('session', id).projectId)
        return {
          managed: this.repo.changeHeaders(id, typeof p.before === 'string' ? p.before : undefined),
          workspace: project.git ? await this.projects.git(root, 'status') : '',
          diff: p.diff === true && project.git ? await this.projects.git(root, 'diff') : '',
          scope: '受管修改可归因；命令与外部编辑仅展示为工作区变化',
        }
      }
    },
    'changes.get': async (p) => this.repo.changeDetail(string(p.id)),
    'changes.restore': async (p) => {
      {
        if (this.repo.active()) throw new Error('CODING_BUSY')
        const change = this.repo.get('change', string(p.id)),
          root = this.projectPath(change.sessionId)
        if (change.restored) return change
        const run = this.repo.get('run', change.runId)
        await this.projects.restore(root, change, run)
        this.repo.save(
          'run',
          { ...run, verification: 'not_run', fingerprint: null },
          'verification.invalidated',
        )
        return this.repo.save('change', { ...change, restored: true }, 'file.restored', change.path)
      }
    },
  }
  private projectPath(id: string): string {
    return this.repo.get('project', this.repo.get('session', id).projectId).path
  }
}
