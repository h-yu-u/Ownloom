import { createEndpoints, type RuntimeClient, type RuntimeEvent } from '@mlx-studio/api-client'

interface Watcher {
  event: (event: RuntimeEvent) => void
  resync: () => Promise<number | void>
  syncing?: boolean
  buffered?: RuntimeEvent[]
  sequence?: number
  active?: boolean
}

/** Owns one transport and cursor for all observed jobs, including reconnects. */
export class JobObserver {
  private watchers = new Map<string, Set<Watcher>>()
  private abort?: AbortController
  private cursor = 0
  private instance?: string
  constructor(private readonly client: () => Promise<RuntimeClient>) {}

  watch(id: string, after: number, watcher: Watcher): () => void {
    watcher.sequence = after
    watcher.active = true
    const listeners = this.watchers.get(id) ?? new Set<Watcher>()
    listeners.add(watcher)
    this.watchers.set(id, listeners)
    if (!this.abort) {
      this.cursor = after
      this.abort = new AbortController()
      void this.run(this.abort)
    } else if (after < this.cursor) {
      void this.sync(watcher).catch(() => undefined)
    }
    return () => {
      watcher.active = false
      listeners.delete(watcher)
      if (!listeners.size) this.watchers.delete(id)
      if (!this.watchers.size) this.dispose()
    }
  }

  dispose(): void {
    this.abort?.abort()
    this.abort = undefined
    for (const listeners of this.watchers.values()) {
      for (const listener of listeners) listener.active = false
    }
    this.watchers.clear()
    this.instance = undefined
  }

  private async resync(): Promise<void> {
    await Promise.allSettled(
      [...this.watchers.values()].flatMap((listeners) =>
        [...listeners].map((listener) => this.sync(listener)),
      ),
    )
  }

  private async sync(listener: Watcher): Promise<void> {
    if (listener.syncing) return
    listener.syncing = true
    listener.buffered = []
    try {
      const sequence = await listener.resync()
      if (!listener.active) return
      if (sequence !== undefined) listener.sequence = sequence
      for (const event of listener.buffered) {
        if (sequence === undefined || event.seq > sequence) {
          listener.sequence = event.seq
          listener.event(event)
        }
      }
    } finally {
      listener.syncing = false
      listener.buffered = []
    }
  }

  private async run(owner: AbortController): Promise<void> {
    while (!owner.signal.aborted) {
      try {
        const client = await this.client()
        if (owner.signal.aborted) return
        const info = await createEndpoints(client).runtime.info(owner.signal)
        if (owner.signal.aborted || this.abort !== owner) return
        const instance = String(info.instance_id)
        if (this.instance && this.instance !== instance) {
          this.cursor = 0
          await this.resync()
        }
        if (owner.signal.aborted || this.abort !== owner) return
        this.instance = instance
        await this.resync()
        if (owner.signal.aborted) return
        await client.subscribe(
          (event) => {
            if (owner.signal.aborted) return
            if (event.type === 'runtime.resync_required') {
              this.cursor = event.seq
              void this.resync()
              return
            }
            if (event.seq <= this.cursor) return
            this.cursor = event.seq
            const jobId = event.payload.job_id
            if (typeof jobId !== 'string') return
            for (const listener of this.watchers.get(jobId) ?? []) {
              if (listener.syncing) listener.buffered?.push(event)
              else if (event.seq > (listener.sequence ?? 0)) {
                listener.sequence = event.seq
                listener.event(event)
              }
            }
          },
          owner.signal,
          this.cursor,
        )
        if (!owner.signal.aborted) await this.resync()
      } catch {
        if (owner.signal.aborted) return
        await this.resync()
      }
      if (!owner.signal.aborted)
        await new Promise<void>((resolve) => {
          const finish = (): void => {
            clearTimeout(timer)
            owner.signal.removeEventListener('abort', finish)
            resolve()
          }
          const timer = setTimeout(finish, 750)
          owner.signal.addEventListener('abort', finish, { once: true })
        })
    }
  }
}
