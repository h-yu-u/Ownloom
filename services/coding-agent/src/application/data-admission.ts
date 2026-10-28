/** Mutation ownership stays with the caller until its asynchronous work settles. */
export class DataAdmission {
  private closed = false
  private active = 0
  private idle?: () => void

  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('BACKUP_IN_PROGRESS')
    this.active++
    try {
      return await action()
    } finally {
      if (--this.active === 0) this.idle?.()
    }
  }

  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('BACKUP_IN_PROGRESS')
    this.closed = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (this.active) {
        await new Promise<void>((resolve, reject) => {
          this.idle = resolve
          timer = setTimeout(() => reject(new Error('BACKUP_BUSY')), 30000)
        })
      }
      return await action()
    } finally {
      clearTimeout(timer)
      this.idle = undefined
      this.closed = false
    }
  }
}

// Unknown/new methods are mutations by default; long polls must never hold a writer lease.
export const readMethods = new Set([
  'tasks.list',
  'settings.get',
  'events.list',
  'events.wait',
  'capabilities.list',
  'projects.list',
  'projects.get',
  'sessions.list',
  'sessions.get',
  'sessions.snapshot',
  'sessions.files',
  'sessions.read',
  'sessions.changes',
  'changes.get',
  'agent.sessions.list',
  'agent.sessions.get',
  'agent.sessions.snapshot',
  'agent.runs.find',
  'agent.tasks.list',
  'agent.events.list',
  'agent.events.wait',
  'extensions.skills.preview',
  'extensions.skills.inspect',
  'extensions.check',
  'extensions.catalog.list',
  'extensions.mcp.inspect',
  'extensions.mcp.tools',
  'extensions.operations.get',
  'extensions.mutations.get',
  'extensions.bindings.get',
  'extensions.resolve',
  'extensions.events.wait',
])
