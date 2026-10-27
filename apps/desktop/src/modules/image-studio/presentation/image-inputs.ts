import { ref, watch, type Ref } from 'vue'
import { MediaCache } from '../../../capabilities/media'
import type { ImageGateway } from '../application/ports'
import type { ImageDraft } from '../domain/image-state'

export function createImageInputs(form: Ref<ImageDraft>, gateway: ImageGateway) {
  const inputUrls = ref<Record<string, string>>({})
  const inputNames = ref<Record<string, string>>({})
  const uploading = ref(false)
  const inputError = ref<string | null>(null)
  const inputErrors = ref<Record<string, string>>({})
  let epoch = 0
  watch(
    () => [form.value.referenceIds?.[0], form.value.maskId] as const,
    ([current, mask], [previous, previousMask]) => {
      if (previous && current !== previous && mask && mask === previousMask) {
        form.value.maskId = null
        inputError.value = '原图已改变，请重新涂抹修改区域'
      }
    },
    { flush: 'sync' },
  )
  const media = new MediaCache(
    gateway.attachment,
    () => {
      inputUrls.value = media.snapshot()
    },
    24,
  )

  async function restoreInputs(extra: string[] = []): Promise<void> {
    const owner = epoch
    const ids = [
      ...new Set([
        ...extra,
        ...(form.value.referenceIds ?? []),
        ...(form.value.maskId ? [form.value.maskId] : []),
      ]),
    ]
    await Promise.allSettled(
      ids.map(async (id) => {
        try {
          const [metadata] = await Promise.all([gateway.metadata(id), media.get(id)])
          if (owner !== epoch) return
          inputNames.value[id] = metadata.originalName
          delete inputErrors.value[id]
        } catch {
          if (owner === epoch) inputErrors.value[id] = '引用读取失败，请重试或替换'
        }
      }),
    )
    if (owner === epoch)
      inputError.value = Object.keys(inputErrors.value).some((id) => ids.includes(id))
        ? '部分参考图片读取失败，图号已保留。'
        : null
  }
  async function uploadReferences(files: File[]): Promise<void> {
    if (uploading.value) return
    if ((form.value.referenceIds?.length ?? 0) + files.length > 10) {
      inputError.value = '最多使用 10 张参考图，请先移除不需要的图片。'
      return
    }
    const owner = epoch
    uploading.value = true
    inputError.value = null
    try {
      for (const file of files) {
        if (
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
          file.size > 20 * 1024 * 1024
        )
          throw new Error('请使用不超过 20 MB 的 PNG、JPEG 或 WebP 图片。')
        const item = await gateway.upload(file)
        if (owner !== epoch) return
        inputNames.value[item.id] = file.name
        form.value = { ...form.value, referenceIds: [...(form.value.referenceIds ?? []), item.id] }
        await media.get(item.id)
      }
    } catch (cause) {
      if (owner === epoch)
        inputError.value = cause instanceof Error ? cause.message : '上传失败，请重试。'
    } finally {
      if (owner === epoch) uploading.value = false
    }
  }
  async function setMask(blob: Blob | null): Promise<void> {
    if (!blob) {
      form.value = { ...form.value, maskId: null }
      return
    }
    const owner = epoch,
      source = form.value.referenceIds?.[0]
    uploading.value = true
    inputError.value = null
    try {
      const item = await gateway.upload(new File([blob], 'edit-mask.png', { type: 'image/png' }))
      if (owner !== epoch) return
      if (source !== form.value.referenceIds?.[0]) {
        inputError.value = '原图已改变，请重新涂抹'
        return
      }
      form.value = { ...form.value, maskId: item.id }
      await media.get(item.id)
    } catch {
      if (owner === epoch) inputError.value = '区域保存失败，请重新涂抹后保存。'
    } finally {
      if (owner === epoch) uploading.value = false
    }
  }
  function removeReference(index: number): void {
    const ids = [...(form.value.referenceIds ?? [])]
    ids.splice(index, 1)
    form.value = {
      ...form.value,
      referenceIds: ids,
      maskId: index === 0 ? null : form.value.maskId,
    }
  }
  function moveReference(index: number, direction: number): void {
    const ids = [...(form.value.referenceIds ?? [])]
    const destination = index + direction
    if (destination < 0 || destination >= ids.length) return
    const value = ids[index]
    const other = ids[destination]
    if (!value || !other) return
    ids[index] = other
    ids[destination] = value
    form.value = {
      ...form.value,
      referenceIds: ids,
      maskId: index === 0 || destination === 0 ? null : form.value.maskId,
    }
  }
  function disposeInputs(): void {
    epoch += 1
    uploading.value = false
    media.dispose()
  }
  return {
    inputUrls,
    inputErrors,
    inputNames,
    inputError,
    uploading,
    uploadReferences,
    setMask,
    removeReference,
    moveReference,
    restoreInputs,
    disposeInputs,
  }
}
