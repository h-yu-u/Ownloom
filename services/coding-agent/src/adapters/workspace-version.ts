import { watch, type Stats } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { dirname } from 'node:path'

interface Version {
  revision: string
  generation: number
  captured: number
  sequence: number
  files: Map<string, string>
  partial: boolean
  watchFailed: boolean
  stop?: () => void
}
interface Capture {
  file(path: string, info: Stats): Promise<void>
  finish(revision: string): string
}
type Observe = (root: string, changed: () => void, failed: () => void) => () => void
const observeChanges: Observe = (root, changed, failed) => {
  const watcher = watch(root, { recursive: true, persistent: false }, changed)
  watcher.on('error', failed)
  return () => watcher.close()
}
const stamp = (info: Stats) => [info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':')

/** Each project workspace owns its version metadata and every observer used to invalidate it. */
export class WorkspaceVersions {
  private versions = new Map<string, Version>()
  private closed = false
  constructor(private observe: Observe = observeChanges) {}

  private acquire(root: string): Version {
    if (this.closed) throw new Error('WORKSPACE_VERSIONS_CLOSED')
    const previous = this.versions.get(root)
    if (previous) return previous
    const entry: Version = {
      revision: '',
      generation: 0,
      captured: -1,
      sequence: 0,
      files: new Map(),
      partial: false,
      watchFailed: false,
    }
    this.versions.set(root, entry)
    try {
      entry.stop = this.observe(
        root,
        () => {
          entry.generation++
        },
        () => {
          entry.generation++
          entry.watchFailed = true
        },
      )
    } catch {
      entry.watchFailed = true
    }
    return entry
  }

  begin(root: string): Capture {
    const entry = this.acquire(root),
      generation = entry.generation,
      sequence = ++entry.sequence
    const files = new Map<string, string>()
    let partial = false
    entry.captured = -1
    const current = () => this.versions.get(root) === entry && entry.sequence === sequence
    return {
      file: async (path, info) => {
        if (!current()) return
        if (files.size >= 8192) {
          partial = true
          return
        }
        files.set(path, stamp(info))
        for (const directory of [root, dirname(path)]) {
          if (files.has(directory)) continue
          const info = await lstat(directory)
          if (!current()) return
          files.set(directory, stamp(info))
        }
      },
      finish: (revision) => {
        if (!current()) return `partial:released:${revision}`
        entry.revision = revision
        entry.captured = generation
        entry.files = files
        entry.partial = partial || entry.watchFailed
        return entry.generation === generation && !entry.partial
          ? revision
          : `partial:unstable:${revision}`
      },
    }
  }

  /** Snapshot queries only check saved metadata; they never start an observer or hash content. */
  async current(root: string): Promise<string> {
    const entry = this.versions.get(root)
    if (!entry || entry.captured < 0 || entry.partial || entry.watchFailed)
      return 'partial:unavailable'
    const sequence = entry.sequence
    if (entry.generation !== entry.captured) return `stale:${entry.revision}`
    for (const [path, previous] of entry.files) {
      try {
        if (stamp(await lstat(path)) !== previous) return `stale:${entry.revision}`
      } catch {
        return `stale:${entry.revision}`
      }
    }
    if (this.versions.get(root) !== entry || entry.sequence !== sequence)
      return 'partial:unavailable'
    return entry.generation === entry.captured ? entry.revision : `stale:${entry.revision}`
  }

  release(root: string): void {
    const entry = this.versions.get(root)
    this.versions.delete(root)
    entry?.stop?.()
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    const errors: unknown[] = []
    for (const root of this.versions.keys()) {
      try {
        this.release(root)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'WORKSPACE_OBSERVER_CLOSE_FAILED')
  }
}
