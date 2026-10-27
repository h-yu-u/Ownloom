import type { FileExportResult } from '../shared/lib/file-export'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export async function pickModelDirectory(): Promise<string | null> {
  const path = await open({ directory: true, multiple: false, title: '选择模型目录' })
  return typeof path === 'string' ? path : null
}
export async function exportBlob(blob: Blob, filename: string): Promise<FileExportResult> {
  if (isTauri()) {
    if (blob.size > 64 * 1024 * 1024)
      return { kind: 'failed', code: 'too-large', message: '文件超过 64 MiB，无法导出' }
    let bytes: ArrayBuffer
    try {
      bytes = await blob.arrayBuffer()
    } catch {
      return { kind: 'failed', code: 'read-failed', message: '读取导出内容失败' }
    }
    try {
      const saved = await invoke<boolean>('export_blob', bytes, {
        headers: { 'x-mlx-export-name': filename },
      })
      return saved ? { kind: 'saved', filename } : { kind: 'cancelled' }
    } catch {
      return { kind: 'failed', code: 'write-failed', message: '保存文件失败，请重试' }
    }
  }
  let url: string | undefined
  try {
    url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    return { kind: 'download-started', filename }
  } catch {
    return { kind: 'failed', code: 'unavailable', message: '无法发起下载' }
  } finally {
    // Allow the browser to consume the download before releasing its URL.
    if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000)
  }
}

export async function exportBackup(download: () => Promise<Blob>): Promise<FileExportResult> {
  if (isTauri()) {
    try {
      return (await invoke<boolean>('export_backup'))
        ? { kind: 'saved', filename: 'ownloom-backup.zip' }
        : { kind: 'cancelled' }
    } catch {
      return {
        kind: 'failed',
        code: 'write-failed',
        message: '备份未完成，请确认任务已结束并检查可用磁盘',
      }
    }
  }
  return exportBlob(await download(), 'ownloom-backup.zip')
}

export async function pickProjectDirectory(): Promise<string | null> {
  const path = await open({ directory: true, multiple: false, title: '选择开发项目' })
  return typeof path === 'string' ? path : null
}

export async function pickSkillDirectory(): Promise<string | null> {
  const path = await open({ directory: true, multiple: false, title: '选择包含 SKILL.md 的目录' })
  return typeof path === 'string' ? path : null
}
