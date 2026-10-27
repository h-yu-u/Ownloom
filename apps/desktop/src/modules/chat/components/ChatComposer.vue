<script setup lang="ts">
import { NButton, NInput, NTooltip } from 'naive-ui'
import { computed, ref } from 'vue'
import { composerShortcut } from '../../../shared/ui/composer-policy'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import AttachmentCard from './AttachmentCard.vue'
import type { DraftAttachment } from '../domain/chat-draft'

const props = withDefaults(
  defineProps<{
    busy: boolean
    generating?: boolean
    imageLimit: number
    draft: string
    attachments?: readonly DraftAttachment[]
    images?: File[]
    webEnabled?: boolean
    disabledReason?: string
    historyImageCount?: number
    historyVerified?: boolean
    thumbnails?: Record<string, string>
  }>(),
  {
    attachments: () => [],
    webEnabled: false,
    historyImageCount: 0,
    historyVerified: true,
    thumbnails: () => ({}),
    images: () => [],
    disabledReason: '',
  },
)
const emit = defineEmits<{
  'update:draft': [value: string]
  add: [files: File[]]
  remove: [clientId: string]
  retry: [clientId: string]
  preview: [clientId: string]
  toggleWeb: []
  clearVisuals: []
  submit: []
  cancel: []
}>()
const fileInput = ref<HTMLInputElement | null>(null)
const draftValue = computed({
  get: () => props.draft,
  set: (value: string) => emit('update:draft', value),
})
const canSend = computed(
  () =>
    !props.busy && !props.disabledReason && Boolean(props.draft.trim() || props.attachments.length),
)
function submit(): void {
  if (canSend.value) emit('submit')
}
const composing = ref(false)
function handleKeydown(event: KeyboardEvent): void {
  const intent = composerShortcut(event, 'enter', composing.value)
  if (intent === 'ignore') return
  event.preventDefault()
  if (intent === 'trigger') submit()
}
function selected(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files?.length) emit('add', Array.from(input.files))
  input.value = ''
}
function paste(event: ClipboardEvent): void {
  if (props.busy || !event.clipboardData?.files.length) return
  emit('add', Array.from(event.clipboardData.files))
  if (!event.clipboardData.getData('text/plain')) event.preventDefault()
}
function drop(event: DragEvent): void {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  if (props.busy) return
  emit('add', Array.from(event.dataTransfer.files))
  const text = event.dataTransfer.getData('text/plain')
  if (text) emit('update:draft', props.draft + text)
}
function dragover(event: DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
}
</script>
<template>
  <div class="composer" @paste="paste" @drop="drop" @dragover="dragover">
    <div v-if="attachments.length" class="attachment-list">
      <AttachmentCard
        v-for="item in attachments"
        :key="item.clientId"
        :item="item"
        :image-limit="imageLimit"
        :busy="busy"
        :thumbnail="thumbnails[item.clientId]"
        @remove="emit('remove', item.clientId)"
        @retry="emit('retry', item.clientId)"
        @preview="emit('preview', item.clientId)"
      />
    </div>
    <p v-if="historyImageCount" class="composer-hint">
      {{ historyVerified ? '正在参考上一轮的' : '尚未验证历史复用的' }}
      {{ historyImageCount }} 张图片
      <NButton text :disabled="busy" @click="emit('clearVisuals')">移除参考组</NButton>
    </p>
    <NInput
      v-model:value="draftValue"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 6 }"
      placeholder="给 Ownloom 发送消息"
      aria-label="消息内容"
      :bordered="false"
      :theme-overrides="{
        color: 'transparent',
        colorHover: 'transparent',
        colorFocus: 'transparent',
      }"
      @keydown="handleKeydown"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <p
      v-if="disabledReason && (draft.trim() || attachments.length || historyImageCount)"
      class="composer-hint"
      role="status"
    >
      {{ disabledReason }}
    </p>
    <div class="composer-actions">
      <div class="composer-tools">
        <slot name="capabilities" />
        <NTooltip
          ><template #trigger
            ><NButton
              quaternary
              circle
              aria-label="添加附件"
              :disabled="busy"
              @click="fileInput?.click()"
              ><StudioIcon name="paperclip" :size="21" /></NButton></template
          >添加图片、文本、Word 或 PDF</NTooltip
        >
        <NTooltip
          ><template #trigger
            ><NButton
              quaternary
              circle
              class="network-toggle"
              :class="{ 'is-enabled': webEnabled }"
              :type="webEnabled ? 'primary' : 'default'"
              :aria-label="webEnabled ? '联网已开启' : '联网搜索'"
              :aria-pressed="webEnabled"
              :disabled="busy"
              @click="emit('toggleWeb')"
              ><StudioIcon name="globe" :size="20" /></NButton></template
          >{{ webEnabled ? '联网已开启' : '联网搜索' }}</NTooltip
        >
        <slot name="model" />
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.docx,.pdf"
        multiple
        hidden
        @change="selected"
      />
      <div class="composer-send">
        <NButton
          v-if="generating ?? busy"
          circle
          secondary
          class="send-button"
          aria-label="停止生成"
          title="停止生成"
          @click="emit('cancel')"
          ><StudioIcon name="stop" :size="16"
        /></NButton>
        <NButton
          v-else
          type="primary"
          circle
          aria-label="发送"
          title="发送 · Enter"
          class="send-button"
          :loading="busy"
          :disabled="!canSend"
          @click="submit"
          ><StudioIcon name="up" :size="20" /><span class="send-label">发送</span></NButton
        >
      </div>
    </div>
  </div>
</template>
<style scoped>
.composer-hint {
  margin: 6px 0;
  color: var(--muted);
  font-size: 12px;
}
</style>
<style scoped src="./ChatComposer.styles.css"></style>
