import { computed, ref } from 'vue'
import type { ExportActionResult, FileExportResult } from './file-export'

/** The signal guards preparation up to the dialog; committed writes keep their real result. */
export function createExportOperation() {
  const pending = ref<Record<string, symbol>>({})
  const lifetimes = new Set<AbortController>()
  let generation = 0
  async function run(input: {
    id: string
    read(): Promise<Blob>
    write(blob: Blob, signal: AbortSignal): Promise<FileExportResult>
  }): Promise<ExportActionResult> {
    if (pending.value[input.id]) return { kind: 'blocked', reason: '正在导出此文件' }
    const action = Symbol(),
      owner = generation
    const lifetime = new AbortController()
    lifetimes.add(lifetime)
    pending.value = { ...pending.value, [input.id]: action }
    try {
      let blob: Blob
      try {
        blob = await input.read()
      } catch (cause) {
        if (owner !== generation) return { kind: 'obsolete' }
        return {
          kind: 'failed',
          code: 'read-failed',
          message: cause instanceof Error ? cause.message : '读取导出内容失败',
        }
      }
      if (owner !== generation) return { kind: 'obsolete' }
      try {
        return await input.write(blob, lifetime.signal)
      } catch (cause) {
        if (lifetime.signal.aborted && cause === lifetime.signal.reason) return { kind: 'obsolete' }
        return {
          kind: 'failed',
          code: 'write-failed',
          message: cause instanceof Error ? cause.message : '保存文件失败',
        }
      }
    } finally {
      lifetimes.delete(lifetime)
      if (pending.value[input.id] === action) {
        const next = { ...pending.value }
        delete next[input.id]
        pending.value = next
      }
    }
  }
  function invalidate(): void {
    generation++
    for (const lifetime of lifetimes) lifetime.abort()
    lifetimes.clear()
    pending.value = {}
  }
  return {
    run,
    invalidate,
    pending,
    firstId: computed(() => Object.keys(pending.value)[0] ?? null),
  }
}
