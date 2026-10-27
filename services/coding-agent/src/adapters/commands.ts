import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
export interface CommandResult {
  exitCode: number | null
  output: string
  truncated: boolean
}
export class Commands {
  constructor(private processEvent: (pid: number, state: 'start' | 'end') => void = () => {}) {}
  private children = new Set<ReturnType<typeof spawn>>()
  async run(command: string, cwd: string, signal?: AbortSignal): Promise<CommandResult> {
    if (signal?.aborted) throw new Error('CANCELLED')
    // This is an approved local command, not an OS sandbox. No provider/session credentials.
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', command], {
        cwd,
        detached: true,
        env: {
          PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
          LANG: 'en_US.UTF-8',
          TMPDIR: '/tmp',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.children.add(child)
      if (child.pid) this.processEvent(child.pid, 'start')
      let output = '',
        truncated = false,
        timedOut = false
      const append = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        if (output.length + text.length > 65536) truncated = true
        output = (output + text).slice(0, 65536)
      }
      child.stdout.on('data', append)
      child.stderr.on('data', append)
      const kill = (): void => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
              reject(error)
          }
        }
      }
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, 120000)
      signal?.addEventListener('abort', kill, { once: true })
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', kill)
        kill()
        this.children.delete(child)
        if (child.pid) this.processEvent(child.pid, 'end')
      }
      child.on('error', (error) => {
        cleanup()
        reject(error)
      })
      child.on('close', (code) => {
        cleanup()
        resolve({
          exitCode: signal?.aborted || timedOut ? null : code,
          output: output + (timedOut ? '\nCOMMAND_TIMEOUT' : signal?.aborted ? '\nCANCELLED' : ''),
          truncated,
        })
      })
    })
  }
  close(): void {
    for (const child of this.children) {
      if (child.pid)
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
        }
    }
  }
}
