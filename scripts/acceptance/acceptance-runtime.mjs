import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  isolatedEnvironment,
  processTable,
  processTree,
  sameProcess,
  sleep,
  fileDescriptors,
} from './acceptance-system.mjs'

export async function bounded(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function* eventFrames(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    buffer = buffer.replaceAll('\r\n', '\n')
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) yield JSON.parse(data)
    }
  }
}

export class PackagedRuntime {
  constructor(app, root, output, signal) {
    this.app = app
    this.root = root
    this.output = output
    this.signal = signal
    this.token = randomBytes(32).toString('hex')
    this.owned = new Map()
    this.warnings = 0
    this.samplingError = null
  }

  async start() {
    const host = join(this.app, 'Contents/Resources/coding-agent')
    this.log = createWriteStream(join(this.output, 'runtime.stderr.log'), {
      flags: 'a',
      mode: 0o600,
    })
    this.process = spawn(join(this.app, 'Contents/MacOS/mlx-studio-runtime'), [], {
      cwd: join(this.root, 'work'),
      env: isolatedEnvironment(this.root, host, this.token),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
    this.exited = new Promise((resolve, reject) => {
      this.process.once('error', reject)
      this.process.once('close', (code, signal) => resolve({ code, signal }))
    })
    // Always attach a rejection handler, including failures before the handshake.
    this.exited.catch(() => {})
    this.process.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') this.samplingError = error
    })
    let warningBuffer = ''
    this.process.stderr.on('data', (bytes) => {
      this.log.write(bytes)
      warningBuffer += bytes.toString()
      let end
      while ((end = warningBuffer.indexOf('\n')) >= 0) {
        if (/leaked semaphore|resource_tracker.*warning/i.test(warningBuffer.slice(0, end)))
          this.warnings++
        warningBuffer = warningBuffer.slice(end + 1)
      }
    })
    let line = ''
    const handshake = new Promise((resolve, reject) => {
      this.process.stdout.on('data', (bytes) => {
        if (line.includes('\n')) return
        line += bytes.toString()
        if (line.length > 65536) reject(new Error('Oversized Runtime handshake'))
        if (line.includes('\n')) {
          try {
            resolve(JSON.parse(line.split('\n')[0]))
          } catch (error) {
            reject(error)
          }
        }
      })
      this.process.once('error', reject)
      this.process.once('exit', () => reject(new Error('Runtime exited before handshake')))
    })
    const frame = await bounded(handshake, 60000, 'Runtime handshake timed out')
    if (
      frame.type !== 'runtime.ready' ||
      frame.protocol_version !== 1 ||
      !Number.isInteger(frame.port) ||
      frame.port < 1 ||
      frame.port > 65535 ||
      !Number.isInteger(frame.pid) ||
      frame.pid < 2
    )
      throw new Error('Invalid Runtime handshake')
    this.base = `http://127.0.0.1:${frame.port}/internal/v1`
    this.runtimePid = frame.pid
    await this.capture()
    this.monitoring = true
    this.monitor = this.sampleLoop()
    return frame
  }

  async fetch(path, options = {}) {
    this.signal?.throwIfAborted()
    const { timeout = 60000, headers, ...rest } = options
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(this.signal ? [this.signal] : []),
    ])
    const response = await fetch(this.base + path, {
      ...rest,
      signal,
      headers: { Authorization: 'Bearer ' + this.token, ...headers },
    })
    if (!response.ok) {
      // Persist only stable error codes, never prompt text or bearer credentials.
      const payload = await response.json().catch(() => ({}))
      throw new Error(`HTTP ${response.status} ${path.split('?')[0]} ${payload.error?.code ?? ''}`)
    }
    return response
  }

  async json(path, body, options = {}) {
    const response = await this.fetch(path, {
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          }),
      ...options,
    })
    return response.status === 204 ? null : response.json()
  }

  async capture() {
    if (!this.process?.pid) return []
    const rows = processTree(await processTable(), this.process.pid)
    for (const row of rows) this.owned.set(`${row.pid}:${row.started}`, row)
    return rows
  }

  async sampleLoop() {
    while (this.monitoring) {
      try {
        const rows = await this.capture()
        const metrics = await this.json('/runtime/metrics', undefined, { timeout: 10000 })
        this.latest = {
          timestamp: new Date().toISOString(),
          metrics,
          processes: rows.map(({ command: _command, ...row }) => row),
        }
        this.samples.write(JSON.stringify(this.latest) + '\n')
      } catch (error) {
        if (this.monitoring) this.samplingError = error
      }
      await sleep(2000)
    }
  }

  async checkpoint() {
    if (this.samplingError)
      throw new Error('Resource monitor failed', { cause: this.samplingError })
    const metrics = await this.json('/runtime/metrics')
    if (metrics.active_jobs !== 0 || metrics.worker_memory_bytes !== 0)
      throw new Error('Worker/jobs remain after unloading')
    const rows = await this.capture()
    return {
      timestamp: new Date().toISOString(),
      runtimePid: this.runtimePid,
      rssBytes: rows.reduce((total, row) => total + row.rssBytes, 0),
      processes: rows.length,
      descriptors: await fileDescriptors(rows.map((row) => row.pid)),
      metrics,
    }
  }

  async stop(abnormal = false) {
    if (!this.process) return { status: 'not_started' }
    this.monitoring = false
    await this.monitor
    await this.capture()
    if (abnormal && this.process.exitCode === null && this.process.signalCode === null)
      this.process.kill('SIGKILL')
    this.process.stdin.end()
    let exit, failure
    try {
      exit = await bounded(this.exited, 30000, 'Runtime shutdown timed out')
    } catch (error) {
      failure = error
    }
    const deadline = performance.now() + 15000
    let remaining
    do {
      const table = await processTable()
      remaining = table.filter((row) =>
        [...this.owned.values()].some((owned) => sameProcess(row, owned)),
      )
      if (remaining.length) await sleep(200)
    } while (remaining.length && performance.now() < deadline)
    // Report leaks before narrowly cleaning up our own test processes.
    for (const row of remaining) {
      const current = (await processTable()).find((candidate) => sameProcess(candidate, row))
      if (current) {
        try {
          process.kill(row.pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') failure ??= error
        }
      }
    }
    this.log.end()
    await once(this.log, 'finish')
    if (failure) throw failure
    if (remaining.length)
      throw new Error(`Orphan test processes: ${remaining.map((row) => row.pid)}`)
    if (!abnormal && (exit.code !== 0 || exit.signal)) throw new Error('Unclean Runtime exit')
    return {
      status: 'passed',
      abnormal,
      observedProcesses: this.owned.size,
      exit,
      semaphoreWarnings: this.warnings,
    }
  }
}
