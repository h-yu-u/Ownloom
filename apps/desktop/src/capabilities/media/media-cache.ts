/** Bounded Object URL ownership. Disposed or evicted requests cannot revive entries. */
export class MediaCache {
  private running = 0
  private waiting: (() => void)[] = []
  private epoch = 0
  private scope = new AbortController()
  private urls = new Map<string, string>()
  private pins = new Map<string, number>()
  private pending = new Map<string, Promise<string | undefined>>()
  private generations = new Map<string, number>()
  constructor(
    private readonly load: (id: string, signal: AbortSignal) => Promise<Blob>,
    private readonly changed: () => void,
    private readonly limit = 48,
  ) {}
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.urls)
  }
  private async fetch(id: string, signal: AbortSignal): Promise<Blob> {
    if (this.running >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve))
    else this.running++
    try {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return await this.load(id, signal)
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.running--
    }
  }
  get(id: string): Promise<string | undefined> {
    const existing = this.urls.get(id)
    if (existing) {
      this.urls.delete(id)
      this.urls.set(id, existing)
      return Promise.resolve(existing)
    }
    const pending = this.pending.get(id)
    if (pending) return pending
    const epoch = this.epoch
    const generation = this.generations.get(id) ?? 0
    const task = this.fetch(id, this.scope.signal)
      .then((blob) => {
        if (epoch !== this.epoch || generation !== (this.generations.get(id) ?? 0)) return undefined
        const url = URL.createObjectURL(blob)
        this.urls.set(id, url)
        this.trim()
        this.changed()
        return url
      })
      .finally(() => {
        if (this.pending.get(id) === task) this.pending.delete(id)
      })
    this.pending.set(id, task)
    return task
  }
  private trim(): void {
    for (const [id, url] of this.urls) {
      if (this.urls.size <= this.limit) break
      if (this.pins.has(id)) continue
      URL.revokeObjectURL(url)
      this.urls.delete(id)
    }
  }
  retain(id: string): () => void {
    this.pins.set(id, (this.pins.get(id) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.pins.get(id) ?? 1) - 1
      if (count) this.pins.set(id, count)
      else this.pins.delete(id)
      this.trim()
      this.changed()
    }
  }
  evict(id: string): void {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    const url = this.urls.get(id)
    if (url) URL.revokeObjectURL(url)
    this.urls.delete(id)
    this.pending.delete(id)
    this.changed()
  }
  dispose(): void {
    this.scope.abort()
    this.scope = new AbortController()
    this.epoch += 1
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
    this.pending.clear()
    this.generations.clear()
    this.pins.clear()
    this.changed()
  }
}
