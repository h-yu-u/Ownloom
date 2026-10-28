import { ref } from 'vue'
import type { FileExportResult } from '../../shared/lib/file-export'
import type { StorageView } from '@mlx-studio/api-client'
import { createRestorePreview, type RestorePreviewDependencies } from './restore-preview'
export function createDataController(
  deps: RestorePreviewDependencies & {
    storage(): Promise<StorageView>
    cleanup(): Promise<unknown>
    restore(id: string): Promise<unknown>
    backup(): Promise<FileExportResult>
    rollback(): Promise<unknown>
    restart(): Promise<unknown>
  },
) {
  const restorePreview = createRestorePreview(deps)
  const restartRequired = ref(false)
  const storage = ref<StorageView | null>(null),
    pending = ref(false),
    error = ref(''),
    notice = ref('')
  let disposed = false
  async function load() {
    const next = await deps.storage()
    if (!disposed) storage.value = next
  }
  async function perform(action: () => Promise<unknown>, success = '') {
    if (disposed || pending.value) return
    pending.value = true
    error.value = ''
    notice.value = ''
    try {
      await action()
      if (disposed) return
      if (success) notice.value = success
      await load()
    } catch (cause) {
      if (!disposed) error.value = cause instanceof Error ? cause.message : '数据操作失败'
    } finally {
      pending.value = false
    }
  }
  return {
    preview: restorePreview.preview,
    restartRequired,
    inspect: (file: File) => perform(() => restorePreview.inspect(file)),
    cancelPreview: () => perform(restorePreview.cancel),
    dispose: () => {
      disposed = true
      restorePreview.dispose()
    },
    activate: () =>
      perform(async () => {
        if (await restorePreview.activate()) restartRequired.value = true
      }, '恢复资料库已准备，重启应用后生效'),
    rollback: () =>
      perform(async () => {
        await deps.rollback()
        restartRequired.value = true
      }, '已撤销资料库切换，重启后生效'),
    restart: () => perform(deps.restart),
    storage,
    pending,
    error,
    notice,
    load: () => perform(load),
    cleanup: () => perform(deps.cleanup, '已将无引用附件移入回收站'),
    restore: (id: string) => perform(() => deps.restore(id), '已恢复'),
    backup: () =>
      perform(async () => {
        const result = await deps.backup()
        if (result.kind === 'failed') throw new Error(result.message)
        notice.value = result.kind === 'cancelled' ? '已取消导出' : '备份已保存'
      }),
  }
}
