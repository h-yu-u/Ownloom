<script setup lang="ts">
import { NButton, NImage, NSpin, NUpload, NUploadDragger, type UploadFileInfo } from 'naive-ui'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import { useDebounceFn } from '@vueuse/core'
defineProps<{
  ids: string[]
  urls: Record<string, string>
  names: Record<string, string>
  locked: boolean
  uploading: boolean
  errors?: Record<string, string>
}>()
const emit = defineEmits<{
  upload: [files: File[]]
  remove: [index: number]
  move: [index: number, direction: number]
}>()
const pending = new Map<string, File>()
const flushUploads = useDebounceFn(() => {
  emit('upload', [...pending.values()])
  pending.clear()
}, 30)
function changed({ file }: { file: UploadFileInfo }): void {
  if (!file.file) return
  pending.set(file.id, file.file)
  void flushUploads()
}
</script>
<template>
  <section class="reference-input" aria-label="原图与参考图">
    <div class="reference-heading">
      <strong>原图与参考图</strong><span>{{ ids.length }} / 10</span>
    </div>
    <p class="reference-help">
      图 1 是要修改的原图，其余图片可提供颜色、人物或风格参考。在指令中按图号引用。
    </p>
    <NUpload
      :file-list="[]"
      :default-upload="false"
      :show-file-list="false"
      accept="image/png,image/jpeg,image/webp"
      multiple
      :disabled="locked || uploading || ids.length >= 10"
      @change="changed"
    >
      <NUploadDragger
        ><StudioIcon name="plus" :size="23" /><strong>点击或拖入图片</strong
        ><span>PNG / JPEG / WebP · 每张不超过 20 MB</span></NUploadDragger
      >
    </NUpload>
    <div v-if="ids.length" class="reference-grid">
      <div v-for="(id, index) in ids" :key="id" class="reference-card">
        <NImage
          v-if="urls[id]"
          :src="urls[id]"
          :alt="`参考图 ${index + 1}`"
          object-fit="contain"
          :img-props="{ style: 'width:100%;height:100px;object-fit:contain' }"
        />
        <div v-else class="reference-loading">
          <span v-if="errors?.[id]" role="alert">{{ errors[id] }}</span
          ><NSpin v-else size="small" />
        </div>
        <div class="reference-caption">
          <strong>图 {{ index + 1 }}{{ index === 0 ? ' · 原图' : '' }}</strong
          ><span :title="names[id]">{{ names[id] || '已保存的参考图' }}</span>
        </div>
        <div class="reference-actions">
          <NButton
            text
            size="tiny"
            :disabled="locked || uploading || index === 0"
            :aria-label="`将图 ${index + 1} 前移`"
            @click="emit('move', index, -1)"
            >前移</NButton
          >
          <NButton
            text
            size="tiny"
            :disabled="locked || uploading || index === ids.length - 1"
            :aria-label="`将图 ${index + 1} 后移`"
            @click="emit('move', index, 1)"
            >后移</NButton
          >
          <NButton
            text
            size="tiny"
            :disabled="locked || uploading"
            :aria-label="`移除图 ${index + 1}`"
            @click="emit('remove', index)"
            >移除</NButton
          >
        </div>
      </div>
    </div>
    <p v-if="uploading" class="reference-help" role="status">正在保存图片，请稍候…</p>
  </section>
</template>
<style scoped>
.reference-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.reference-heading span,
.reference-help {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.7;
}
.reference-help {
  margin: 7px 0 12px;
}
.reference-input :deep(.n-upload-dragger) {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 15px 8px;
}
.reference-input :deep(.n-upload-dragger strong) {
  font-size: 12px;
  font-weight: 500;
}
.reference-input :deep(.n-upload-dragger span) {
  font-size: 12px;
  color: var(--text-secondary);
}
.reference-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  margin-top: 12px;
}
.reference-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: var(--surface-card);
}
.reference-card .n-image {
  display: block;
  width: 100%;
}
.reference-caption {
  display: grid;
  gap: 3px;
  padding: 7px 8px 3px;
}
.reference-caption strong {
  font-size: 12px;
  color: var(--text-primary);
}
.reference-caption span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-tertiary);
}
.reference-actions {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  padding: 5px 8px 9px;
}
.reference-loading {
  height: 100px;
  display: grid;
  place-items: center;
}
</style>
