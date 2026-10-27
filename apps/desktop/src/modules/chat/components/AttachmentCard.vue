<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import type { DraftAttachment } from '../domain/chat-draft'
import { attachmentBlockReason } from '../domain/attachment-policy'
const props = defineProps<{
  item: DraftAttachment
  imageLimit: number
  busy: boolean
  thumbnail?: string
}>()
defineEmits<{ remove: []; retry: []; preview: [] }>()
const reason = computed(() => attachmentBlockReason(props.item, props.imageLimit))
const label = computed(
  () => reason.value ?? (props.item.processing === 'partial' ? '部分内容可读' : '可使用'),
)
</script>
<template>
  <div class="attachment-card" :class="{ blocked: reason }">
    <img v-if="thumbnail" :src="thumbnail" alt="" class="attachment-thumbnail" />
    <div class="attachment-details">
      <NButton
        text
        :disabled="
          !item.preparationId || !['ready', 'partial', 'needs_ocr'].includes(item.processing)
        "
        @click="$emit('preview')"
        >{{ item.originalName }}</NButton
      >
      <small
        >{{ item.format.toUpperCase() }} · {{ Math.ceil(item.sizeBytes / 1024) }} KiB<span
          v-if="item.pageCount"
        >
          · {{ item.pageCount }} 页</span
        ></small
      >
      <small role="status">{{ label }}</small>
      <small v-for="warning in item.warnings" :key="warning">{{ warning }}</small>
    </div>
    <NButton
      v-if="(item.transfer === 'failed' || item.error) && item.retryable"
      size="tiny"
      :disabled="busy"
      @click="$emit('retry')"
      >{{ item.attachmentId ? '重试解析' : '重试上传' }}</NButton
    >
    <NButton
      text
      :disabled="busy"
      :aria-label="`移除 ${item.originalName}`"
      @click="$emit('remove')"
      >×</NButton
    >
  </div>
</template>
<style scoped>
.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  max-width: 100%;
}
.attachment-card.blocked {
  border-color: var(--muted);
}
.attachment-details {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.attachment-details :deep(button) {
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
}
small {
  color: var(--muted);
  font-size: 11px;
}
.attachment-thumbnail {
  width: 42px;
  height: 42px;
  object-fit: cover;
  border-radius: 6px;
}
</style>
