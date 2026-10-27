import { createImageDraft } from './image-draft'
import type { ImageSnapshot } from './image-state'
import type { RestoreNotice } from '../../../shared/lib/restore-notice'
export function restoreImage(
  item: ImageSnapshot,
  models: readonly { id: string; imageEditing: boolean; inpainting: boolean }[],
  availableReferences: ReadonlySet<string>,
) {
  const adjustments: RestoreNotice[] = [],
    model = models.find((entry) => entry.id === item.model_id)
  const draft = createImageDraft(
    item,
    models.map((entry) => entry.id),
  )
  if (!model)
    adjustments.push({
      code: 'model-missing',
      message: `原模型「${item.model_name}」已移除，请重新选择`,
      blocking: true,
    })
  else if (
    (item.mode === 'edit' && !model.imageEditing) ||
    (item.mode === 'inpaint' && !model.inpainting)
  ) {
    draft.modelId = null
    adjustments.push({
      code: 'model-incompatible',
      message: '原模型不支持此编辑模式，请重新选择',
      blocking: true,
    })
  }
  for (const [index, id] of (item.reference_ids ?? []).entries())
    if (!availableReferences.has(id))
      adjustments.push({
        code: 'reference-missing',
        resourceId: id,
        message: `图 ${index + 1} 已无法读取，图号已保留，请重试或替换`,
        blocking: true,
      })
  if (item.mask_id && !availableReferences.has(item.mask_id)) {
    draft.maskId = null
    adjustments.push({
      code: 'mask-missing',
      message: '原遮罩已无法读取，请重新涂抹',
      blocking: true,
    })
  }
  return { draft, adjustments, canSubmit: !adjustments.some((item) => item.blocking) }
}
