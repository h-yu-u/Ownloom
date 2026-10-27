<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton } from 'naive-ui'
import MarkdownContent from '../../../shared/ui/MarkdownContent.vue'
import { useMarkdownCopy } from '../../../shared/ui/markdown-copy'
import { copyText } from '../../../platform/clipboard'
import type { ChatMessage } from '../domain/chat-state'
import MessageSources from './MessageSources.vue'
import MessageActions from './MessageActions.vue'
import type { MessageSource } from '../domain/message-source'

const props = defineProps<{ message: ChatMessage; canContinue?: boolean; busy?: boolean }>()
defineEmits<{
  continue: []
  preview: [source: MessageSource]
  regenerate: []
  attachment: [file: NonNullable<ChatMessage['attachments']>[number]]
}>()
const sourceList = ref<InstanceType<typeof MessageSources> | null>(null)
const prefix = computed(() => `source-${encodeURIComponent(props.message.id)}-`)
const sourceMap = computed(() => props.message.sources)
const citations = computed(() =>
  Object.fromEntries(
    (sourceMap.value ?? []).map((source) => [source.id, `#${prefix.value}${source.id}`]),
  ),
)
const { copyState, copyCode } = useMarkdownCopy(copyText)
</script>

<template>
  <article
    class="message"
    :class="message.role"
    :aria-label="message.role === 'user' ? '用户消息' : '助手消息'"
  >
    <div v-if="message.role === 'assistant'" class="message-role">Ownloom</div>
    <ul v-if="message.attachments?.length" class="message-attachments" aria-label="消息附件">
      <li v-for="attachment in message.attachments" :key="attachment.id">
        <NButton text @click="$emit('attachment', attachment)"
          ><span aria-hidden="true">▧</span> {{ attachment.originalName }}</NButton
        >
      </li>
    </ul>
    <MarkdownContent
      class="message-body markdown-body"
      :content-id="message.id"
      :source="message.content"
      :streaming="message.state === 'streaming'"
      :citations="citations"
      :copy-state="copyState"
      @copy-code="copyCode"
      @open-citation="sourceList?.reveal($event)"
    />
    <p v-if="message.parameters?.attemptMode === 'local_only'" class="message-limit">
      未进行新的联网检索。
    </p>
    <MessageSources
      ref="sourceList"
      :sources="message.sources ?? []"
      :prefix="prefix"
      @preview="$emit('preview', $event)"
    />
    <MessageActions
      v-if="message.role === 'assistant' && message.state !== 'streaming' && message.content"
      :message="message"
      :latest="canContinue"
      :busy="busy"
      @regenerate="$emit('regenerate')"
      @continue="$emit('continue')"
    />
  </article>
</template>

<style scoped>
.message-attachments {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
}
.message-attachments li {
  padding: 5px 9px;
  border-radius: 8px;
  background: var(--surface-card);
  font-size: 12px;
}
</style>

<style scoped src="./MessageBubble.styles.css"></style>
