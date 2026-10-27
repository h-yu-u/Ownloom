<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTooltip } from 'naive-ui'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import { useMarkdownCopy } from '../../../shared/ui/markdown-copy'
import { copyText } from '../../../platform/clipboard'
import type { ChatMessage } from '../domain/chat-state'

const props = defineProps<{ message: ChatMessage; latest?: boolean; busy?: boolean }>()
const emit = defineEmits<{ regenerate: []; continue: [] }>()
const { copyState, copyCode } = useMarkdownCopy(copyText)
const copyLabel = computed(() => {
  if (copyState.value?.phase === 'copied') return '已复制'
  if (copyState.value?.phase === 'failed') return '复制失败，重试'
  return '复制回答'
})
const online = computed(() => props.message.sources?.some((source) => source.kind === 'web'))
function copy(): void {
  void copyCode({
    contentId: props.message.id,
    blockKey: 'answer',
    requestId: crypto.randomUUID(),
    text: props.message.content,
  })
}
</script>

<template>
  <div class="message-actions" role="group" aria-label="回答操作">
    <NTooltip>
      <template #trigger>
        <NButton
          quaternary
          circle
          size="small"
          :aria-label="copyLabel"
          :loading="copyState?.phase === 'pending'"
          @click="copy"
          ><StudioIcon :name="copyState?.phase === 'copied' ? 'check' : 'copy'" :size="17"
        /></NButton>
      </template>
      {{ copyLabel }}
    </NTooltip>
    <NTooltip v-if="latest">
      <template #trigger>
        <NButton
          quaternary
          circle
          size="small"
          aria-label="重新生成"
          :disabled="busy"
          @click="emit('regenerate')"
          ><StudioIcon name="refresh" :size="17"
        /></NButton>
      </template>
      {{ online ? '重新搜索并生成回答' : '重新生成回答' }}
    </NTooltip>
    <NTooltip v-if="latest && message.finishReason === 'length'">
      <template #trigger>
        <NButton
          quaternary
          size="small"
          aria-label="继续回答"
          :disabled="busy"
          @click="emit('continue')"
          ><template #icon><StudioIcon name="play" :size="16" /></template>继续回答</NButton
        >
      </template>
      已达到本次输出长度上限，可以继续回答
    </NTooltip>
    <span v-if="copyState?.phase === 'failed'" role="status">复制失败，请重试</span>
  </div>
</template>

<style scoped>
.message-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px;
  color: var(--text-tertiary);
}
.message-actions span[role='status'] {
  font-size: 12px;
}
</style>
