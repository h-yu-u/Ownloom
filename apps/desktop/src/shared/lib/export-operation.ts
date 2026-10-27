import { computed, ref } from 'vue'
import type { ExportActionResult, FileExportResult } from './file-export'

/** Read ownership is checked before opening a dialog; completed writes keep their real result. */
export function createExportOperation() {
  const pending = ref<Record<string, symbol>>({})
  let generation = 0
  async function run(input: {
    id: string
    read(): Promise<Blob>
    write(blob: Blob): Promise<FileExportResult>
  }): Promise<ExportActionResult> {
    if (pending.value[input.id]) return { kind: 'blocked', reason: '正在导出此文件' }
    const action = Symbol(),
      owner = generation
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
        return await input.write(blob)
      } catch (cause) {
        return {
          kind: 'failed',
          code: 'write-failed',
          message: cause instanceof Error ? cause.message : '保存文件失败',
        }
      }
    } finally {
      if (pending.value[input.id] === action) {
        const next = { ...pending.value }
        delete next[input.id]
        pending.value = next
      }
    }
  }
  function invalidate(): void {
    generation++
    pending.value = {}
  }
  return {
    run,
    invalidate,
    pending,
    firstId: computed(() => Object.keys(pending.value)[0] ?? null),
  }
}
