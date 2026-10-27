interface Reservation<T> {
  id: string
  input: T
  committed: boolean
  launched: boolean
  timer?: ReturnType<typeof setTimeout>
}
/** Reserve queue position synchronously; network authorization happens after reservation. */
export class RunReservations<T> {
  private main?: Reservation<T>
  private queue: Reservation<T>[] = []
  private stopped = false
  constructor(private expire: (id: string) => void) {}
  get busy(): boolean {
    return !!this.main
  }
  check(queue: boolean): void {
    if (this.stopped) throw new Error('HOST_SHUTTING_DOWN')
    if (this.main && !queue) throw new Error('CODING_BUSY')
    if (this.main && this.queue.length >= 1) throw new Error('CODING_QUEUE_FULL')
  }
  add(id: string, input: T, committed: boolean): void {
    const item: Reservation<T> = { id, input, committed, launched: false }
    if (!committed) item.timer = setTimeout(() => this.expire(id), 60000)
    if (this.main) this.queue.push(item)
    else this.main = item
  }
  commit(id: string, update: (input: T) => T): void {
    const item = this.main?.id === id ? this.main : this.queue.find((item) => item.id === id)
    if (!item) throw new Error('RUN_NOT_READY')
    if (item.committed) return
    item.input = update(item.input)
    item.committed = true
    clearTimeout(item.timer)
  }
  next(): { id: string; input: T } | undefined {
    if (this.stopped || !this.main?.committed || this.main.launched) return
    this.main.launched = true
    return { id: this.main.id, input: this.main.input }
  }
  finish(id: string): void {
    if (this.main?.id !== id) return
    clearTimeout(this.main.timer)
    this.main = this.queue.shift()
  }
  remove(id: string): boolean {
    if (this.main?.id === id && !this.main.launched) {
      this.finish(id)
      return true
    }
    const index = this.queue.findIndex((item) => item.id === id)
    if (index < 0) return false
    clearTimeout(this.queue[index].timer)
    this.queue.splice(index, 1)
    return true
  }
  stop(): string[] {
    this.stopped = true
    return [
      ...(this.main && !this.main.launched ? [this.main.id] : []),
      ...this.queue.map((item) => item.id),
    ]
  }
}
