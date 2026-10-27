export type FileExportResult =
  | { kind: 'saved'; filename: string }
  | { kind: 'download-started'; filename: string }
  | { kind: 'cancelled' }
  | {
      kind: 'failed'
      code: 'too-large' | 'read-failed' | 'write-failed' | 'unavailable'
      message: string
    }
export type ExportActionResult =
  | FileExportResult
  | { kind: 'obsolete' }
  | { kind: 'blocked'; reason: string }
export function exportFeedback(
  result: ExportActionResult,
): { type: 'success' | 'error'; message: string } | null {
  if (result.kind === 'saved') return { type: 'success', message: '已保存' }
  if (result.kind === 'download-started') return { type: 'success', message: '已发起下载' }
  if (result.kind === 'failed') return { type: 'error', message: result.message }
  return null
}
