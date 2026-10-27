import { RuntimeError } from '@mlx-studio/api-client'

export class JobPoller {
  private timer?: ReturnType<typeof setTimeout>
  private epoch = 0
  private failures = 0
  schedule(run: () => Promise<void>, delay = 750): void {
    this.stop()
    const epoch = this.epoch
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (epoch === this.epoch) void run()
    }, delay)
  }
  recovered(): void {
    this.failures = 0
  }
  retry(run: () => Promise<void>, error: unknown): void {
    if ((error instanceof Error || error instanceof DOMException) && error.name === 'AbortError')
      return
    if (
      error instanceof RuntimeError &&
      ([401, 403, 404].includes(error.status) || !error.retryable)
    )
      return
    this.schedule(run, Math.min(750 * 2 ** Math.min(this.failures++, 4), 10000))
  }
  stop(): void {
    this.epoch += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
