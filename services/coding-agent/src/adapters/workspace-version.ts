import { watch, type Stats } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { dirname } from 'node:path'
interface Version {
  revision: string
  generation: number
  captured: number
  files: Map<string, string>
  partial: boolean
}
const versions = new Map<string, Version>()
const stamp = (info: Stats) => [info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':')

export function beginCapture(root: string): (revision: string) => string {
  let entry = versions.get(root)
  if (!entry) {
    entry = { revision: '', generation: 0, captured: -1, files: new Map(), partial: false }
    versions.set(root, entry)
    const target = entry
    try {
      const watcher = watch(root, { recursive: true, persistent: false }, () => {
        target.generation++
      })
      watcher.on('error', () => {
        target.generation++
        target.captured = -1
      })
    } catch {
      entry.partial = true
    }
  }
  const target = entry,
    generation = entry.generation
  target.files.clear()
  return (revision) => {
    target.revision = revision
    target.captured = generation
    return target.generation === generation && !target.partial
      ? revision
      : `partial:unstable:${revision}`
  }
}
export async function captureFile(root: string, path: string, info: Stats): Promise<void> {
  const entry = versions.get(root)
  if (!entry) return
  if (entry.files.size >= 8192) {
    entry.partial = true
    return
  }
  entry.files.set(path, stamp(info))
  for (const directory of [root, dirname(path)]) {
    if (!entry.files.has(directory)) entry.files.set(directory, stamp(await lstat(directory)))
  }
}

/** Check saved index metadata; no traversal or content hashing occurs in snapshot queries. */
export async function currentVersion(root: string): Promise<string> {
  const entry = versions.get(root)
  if (!entry || entry.partial) return 'partial:unavailable'
  if (entry.generation !== entry.captured) return `stale:${entry.revision}`
  for (const [path, previous] of entry.files) {
    try {
      if (stamp(await lstat(path)) !== previous) return `stale:${entry.revision}`
    } catch {
      return `stale:${entry.revision}`
    }
  }
  return entry.revision
}
