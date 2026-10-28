import { randomUUID } from 'node:crypto'
import { buildSnapshot } from './snapshot.js'
import type { ProjectPort } from './ports.js'
import type { ProjectSessionsRepository } from './repository-ports.js'
import { string } from '../domain/types.js'
export class ProjectSessions {
  constructor(
    private repo: ProjectSessionsRepository,
    private projects: ProjectPort,
    private checkAdmission: () => void,
  ) {}
  close(): void {
    this.projects.close()
  }
  handlers: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
    'projects.list': async (p) => {
      return this.repo.list('project')
    },
    'projects.register': async (p) => {
      {
        const project = await this.projects.register(string(p.path))
        return this.repo.findProject(project.path) ?? this.repo.save('project', project)
      }
    },
    'projects.get': async (p) => {
      return this.repo.get('project', string(p.id))
    },
    'projects.update': async (p) => {
      {
        const project = this.repo.get('project', string(p.id))
        if (this.repo.active()) throw new Error('CODING_BUSY')
        const commands = p.commands
        if (!Array.isArray(commands) || commands.length > 8) throw new Error('INVALID_COMMANDS')
        return this.repo.save('project', {
          ...project,
          commands: commands.map((value) => string(value, 4096)),
        })
      }
    },
    'projects.remove': async (p) => {
      {
        const id = string(p.id)
        if (this.repo.listSessions(id, undefined, 1).length > 0)
          throw new Error('PROJECT_HAS_SESSIONS')
        const project = this.repo.find('project', id)
        this.repo.delete('project', id)
        if (project) this.projects.release(project.path)
        return { removed: true }
      }
    },
    'sessions.list': async (p) => {
      return this.repo.listSessions(
        string(p.projectId),
        typeof p.before === 'string' ? p.before : undefined,
        typeof p.limit === 'number' ? p.limit : 100,
      )
    },
    'sessions.create': async (p) => {
      {
        const project = this.repo.get('project', string(p.projectId))
        return this.repo.save('session', {
          id: randomUUID(),
          projectId: project.id,
          title: typeof p.title === 'string' ? string(p.title, 160) : '新开发会话',
          pinned: false,
          archived: false,
          piPath: null,
        })
      }
    },
    'sessions.get': async (p) => {
      return this.repo.get('session', string(p.id))
    },
    'sessions.update': async (p) => {
      {
        const session = this.repo.get('session', string(p.id))
        if (this.repo.active(session.id) && p.archived === true) throw new Error('SESSION_IN_USE')
        return this.repo.save('session', {
          ...session,
          title: p.title === undefined ? session.title : string(p.title, 160),
          ...(p.title === undefined ? {} : { titleSource: 'manual' as const }),
          pinned: typeof p.pinned === 'boolean' ? p.pinned : session.pinned,
          archived: typeof p.archived === 'boolean' ? p.archived : session.archived,
        })
      }
    },
    'sessions.remove': async (p) => {
      {
        this.checkAdmission()
        const id = string(p.id)
        if (this.repo.active(id)) throw new Error('SESSION_IN_USE')
        this.repo.get('session', id)
        this.repo.deleteSession(id)
        return { removed: true }
      }
    },
    'sessions.snapshot': async (p) =>
      buildSnapshot(this.repo, this.projects.version ?? this.projects.fingerprint, string(p.id)),
  }
}
