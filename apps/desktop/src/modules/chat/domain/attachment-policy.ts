import type { AttachmentFormat, ChatDraft, DraftAttachment } from './chat-draft'

export const attachmentPolicy = {
  maxCount: 8,
  maxFileBytes: 20 * 1024 ** 2,
  maxTotalBytes: 60 * 1024 ** 2,
}
export function describeFile(
  name: string,
): { kind: DraftAttachment['kind']; format: AttachmentFormat } | undefined {
  const suffix = name.toLowerCase().split('.').at(-1)
  const format = suffix === 'jpg' ? 'jpeg' : suffix
  if (format === 'png' || format === 'jpeg' || format === 'webp' || format === 'gif')
    return { kind: 'image', format }
  if (format === 'txt' || format === 'md' || format === 'docx' || format === 'pdf')
    return { kind: 'document', format }
  return undefined
}
export function attachmentBlockReason(
  item: DraftAttachment,
  imageLimit: number,
): string | undefined {
  if (item.kind === 'image' && imageLimit === 0) return '当前模型不支持此图片'
  if (item.transfer === 'failed') return item.error ?? '上传失败'
  if (item.transfer !== 'stored') return '上传中'
  if (item.processing === 'needs_ocr') return '此文件需要 OCR，暂不能读取'
  if (item.processing === 'failed' || item.processing === 'cancelled')
    return item.error ?? '解析失败'
  if (!['ready', 'partial'].includes(item.processing)) return '解析中'
  return undefined
}
export function getSendEligibility(
  draft: ChatDraft,
  imageLimit: number,
  busy: boolean,
  historyImageCount = 0,
  historyImagesVerified = true,
): { allowed: boolean; reason?: string } {
  const { attachments } = draft
  const blocked = (reason: string) => ({ allowed: false, reason })
  if (busy) return blocked('请等待当前任务完成')
  if (
    attachments.length > attachmentPolicy.maxCount ||
    attachments.reduce((sum, item) => sum + item.sizeBytes, 0) > attachmentPolicy.maxTotalBytes
  )
    return blocked('附件数量或总大小超限')
  for (const item of attachments) {
    if (item.sizeBytes > attachmentPolicy.maxFileBytes) return blocked('单文件不能超过 20 MiB')
    const reason = attachmentBlockReason(item, imageLimit)
    if (reason) return blocked(`${item.originalName}：${reason}`)
  }
  const images = attachments.filter((item) => item.kind === 'image').length
  const effective =
    draft.visualSelection.mode === 'explicit'
      ? draft.visualSelection.attachmentIds.length
      : images || (draft.visualSelection.mode === 'auto' ? historyImageCount : 0)
  if (effective > imageLimit)
    return blocked(`当前模型最多支持 ${imageLimit} 张图片，请移除图片或切换模型`)
  if (draft.visualSelection.mode === 'none' && images) return blocked('请先移除本轮新图片')
  if (historyImageCount > 0 && !historyImagesVerified && draft.visualSelection.mode === 'auto')
    return blocked('历史图片复用尚未验证，请移除参考组或重新添加图片')
  if (!draft.text.trim() && !attachments.length) return blocked('请输入问题或添加附件')
  if (draft.webSearchEnabled && !draft.text.trim()) return blocked('请补充联网搜索的问题或关闭联网')
  return { allowed: true }
}
