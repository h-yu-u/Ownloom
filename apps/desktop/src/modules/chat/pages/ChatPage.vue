<script setup lang="ts">
import { phaseLabel } from '../domain/phase-label'
import { regenerationMode } from '../domain/answer-attempt'
import { NButton, NDrawer, NDrawerContent, NSelect, useMessage } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { RuntimeStatusBanner as RuntimeStatus } from '../../../capabilities/runtime'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import ChatComposer from '../components/ChatComposer.vue'
import AttachmentPreview from '../components/AttachmentPreview.vue'
import { getSendEligibility } from '../domain/attachment-policy'
import { useWebSearch } from '../../../capabilities/web-search'
import type { MessageSource } from '../domain/message-source'
import type { ChatMessage } from '../domain/chat-state'
import ChatInspector from '../components/ChatInspector.vue'
import ChatMessageList from '../components/ChatMessageList.vue'
import { useRuntimeStore } from '../../../capabilities/runtime'
import { useChatStore } from '../stores/chat.store'
const store = useChatStore()
const runtime = useRuntimeStore()
const message = useMessage()
const router = useRouter()
const route = useRoute()
watch(
  () => route.query.conversationId,
  (id) => {
    if (typeof id === 'string' && id !== store.conversationId) void store.openConversation(id)
  },
)
const { state, models, selectedModelId, busy, pending, maxTokens, temperature } = storeToRefs(store)
const drafts =
  store.drafts ??
  (() => {
    throw new Error('Chat drafts are not configured')
  })()
const web = useWebSearch()
const draft = computed({ get: () => drafts.draft.text, set: (value) => drafts.setText(value) })
const historyImages = computed(() => {
  if (
    drafts.draft.visualSelection.mode !== 'auto' ||
    drafts.draft.attachments.some((item) => item.kind === 'image')
  )
    return 0
  return (
    [...state.value.messages]
      .reverse()
      .find(
        (item) =>
          item.role === 'user' &&
          item.attachments?.some((file) => file.mimeType.startsWith('image/')),
      )
      ?.attachments?.filter((file) => file.mimeType.startsWith('image/')).length ?? 0
  )
})
const eligibility = computed(() =>
  getSendEligibility(
    drafts.draft,
    imageLimit.value,
    busy.value || pending.value,
    historyImages.value,
    selectedModel.value?.capabilities.historyImages === true,
  ),
)
watch(
  () =>
    drafts.draft.attachments
      .map((item) => `${item.attachmentId}:${item.preparationId}:${item.processing}`)
      .join(','),
  () => {
    void drafts.loadThumbnails()
  },
  { immediate: true },
)
watch(
  () => drafts.draft.key,
  () => drafts.preview.close(),
)
async function toggleWeb(): Promise<void> {
  if (busy.value || pending.value) return
  try {
    if (!drafts.draft.webSearchEnabled) {
      await web.load()
      if (!web.settings?.ready) {
        message.info('请在设置中保存联网搜索配置并测试连接')
        await router.push('/settings')
        return
      }
      message.info('搜索关键词会发送给所配置的搜索服务，附件在本地解析。')
    }
    await drafts.setWeb(!drafts.draft.webSearchEnabled)
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '联网设置更新失败')
  }
}
async function openSource(source: MessageSource): Promise<void> {
  if (source.kind === 'file')
    await drafts.preview.open(
      {
        id: source.attachmentId,
        preparationId: source.preparationId,
        kind: source.representation === 'image' ? 'image' : 'document',
        originalName: source.originalName,
      },
      'history',
    )
}
async function openAttachment(
  file: NonNullable<ChatMessage['attachments']>[number],
): Promise<void> {
  if (!file.preparationId && !file.mimeType.startsWith('image/')) return
  await drafts.preview.open(
    {
      id: file.id,
      preparationId: file.preparationId ?? '',
      kind: file.mimeType.startsWith('image/') ? 'image' : 'document',
      originalName: file.originalName,
    },
    'history',
  )
}
async function retryAnswer(
  mode: 'regenerate' | 'refresh_web' | 'local_only',
  assistant?: ChatMessage,
): Promise<void> {
  const user = [...state.value.messages]
    .reverse()
    .find(
      (item) => item.role === 'user' && (!assistant?.turnId || item.turnId === assistant.turnId),
    )
  if (!user) return
  try {
    await store.attempt(
      user.id,
      mode === 'regenerate' ? regenerationMode(assistant) : mode,
      typeof assistant?.parameters?.contextJobId === 'string'
        ? assistant.parameters.contextJobId
        : undefined,
    )
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '重试失败')
  }
}
const phaseText = computed(() => phaseLabel(store.phase))
const showInspector = ref(false)
const options = computed(() =>
  models.value.map((model) => ({ label: model.displayName, value: model.id })),
)
const selectedModel = computed(() =>
  models.value.find((model) => model.id === selectedModelId.value),
)
const imageLimit = computed(
  () =>
    selectedModel.value?.inputLimits?.maxImages ??
    (selectedModel.value?.inputModalities.includes('image')
      ? selectedModel.value.multiImage
        ? 4
        : 1
      : 0),
)
onMounted(async () => {
  await store.loadWorkspace()
  if (typeof route.query.conversationId === 'string')
    await store.openConversation(route.query.conversationId)
})
onBeforeUnmount(() => store.dispose())

async function send(): Promise<void> {
  if (!eligibility.value.allowed) return
  try {
    await store.send(draft.value, [], { skillIds: [], toolIds: [] })
  } catch (error) {
    message.error(error instanceof Error ? error.message : '发送失败')
  }
}
async function cancel(): Promise<void> {
  try {
    await store.cancel()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '停止生成失败')
  }
}

async function continueReply(): Promise<void> {
  if (pending.value || busy.value) return
  try {
    await store.send('请从上一个回答中断的位置继续，不要重复已经输出的内容。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '继续回答失败')
  }
}
</script>

<template>
  <section class="chat-workspace">
    <header class="chat-toolbar">
      <div class="toolbar-actions">
        <RuntimeStatus :busy="busy || pending" @reconnected="store.loadWorkspace" />
        <NButton
          quaternary
          circle
          aria-label="打开模型设置"
          :aria-expanded="showInspector"
          @click="showInspector = true"
        >
          <StudioIcon name="settings" :size="19" />
        </NButton>
      </div>
    </header>
    <section class="chat-stage" :class="{ 'is-new': !state.messages.length }" aria-label="对话">
      <NButton v-if="store.nextCursor" @click="store.loadMore">加载更早消息</NButton>
      <ChatMessageList
        :messages="state.messages"
        :total-count="state.messages.length"
        :status="state.status"
        :error="state.error"
        :busy="busy || pending"
        @image="router.push({ path: '/image-studio', query: { prompt: $event } })"
        @continue="continueReply"
        @preview="openSource"
        @attachment="openAttachment"
        @regenerate="retryAnswer('regenerate', $event)"
      />
      <p v-if="busy" role="status">{{ phaseText }}</p>
      <div v-if="state.status === 'error' && state.messages.some((item) => item.role === 'user')">
        <NButton
          v-if="state.errorCode?.startsWith('WEB_')"
          :disabled="busy || pending"
          @click="retryAnswer('refresh_web')"
          >重试联网</NButton
        >
        <NButton
          v-if="state.errorCode?.startsWith('WEB_')"
          :disabled="busy || pending"
          @click="retryAnswer('local_only')"
          >使用本地资料回答</NButton
        >
      </div>
      <p v-if="state.errorCode?.includes('CONTEXT')" role="status">
        请减少资料、调整输出长度或选择更大上下文的模型。
      </p>
      <NButton v-if="state.errorCode?.startsWith('MODEL_')" @click="router.push('/models')"
        >选择或重新加载模型</NButton
      >
      <ChatComposer
        v-model:draft="draft"
        :attachments="drafts.draft.attachments"
        :web-enabled="drafts.draft.webSearchEnabled"
        :disabled-reason="store.readiness.blockers[0]?.recovery || eligibility.reason"
        :history-image-count="historyImages"
        :history-verified="selectedModel?.capabilities.historyImages === true"
        :thumbnails="drafts.thumbnailUrls"
        :busy="busy || pending"
        :generating="busy"
        :image-limit="imageLimit"
        @add="drafts.add"
        @remove="drafts.remove"
        @retry="drafts.retry"
        @preview="drafts.open"
        @toggle-web="toggleWeb"
        @clear-visuals="drafts.ignoreVisuals"
        @submit="send"
        @cancel="cancel"
      >
        <template #model>
          <div class="composer-model">
            <span class="model-status-dot" :class="{ 'model-status-offline': !models.length }" />
            <NSelect
              :value="selectedModel?.id ?? null"
              class="model-select"
              size="small"
              :bordered="false"
              :options="options"
              :disabled="busy || pending"
              :loading="state.status === 'loading'"
              placeholder="选择本地模型"
              aria-label="当前模型"
              placement="top-start"
              @update:value="selectedModelId = $event"
            />
          </div>
        </template>
      </ChatComposer>
    </section>
    <p v-if="drafts.error" role="alert">{{ drafts.error }}</p>
    <AttachmentPreview :preview="drafts.preview" />
    <NDrawer v-model:show="showInspector" :width="360" placement="right">
      <NDrawerContent title="本次模型参数" closable>
        <ChatInspector
          v-model:max-tokens="maxTokens"
          v-model:temperature="temperature"
          :selected-model="selectedModel"
          :runtime="runtime"
          :busy="busy || pending"
          @reset="store.resetParameters"
        />
      </NDrawerContent>
    </NDrawer>
  </section>
</template>

<style scoped src="./ChatPage.styles.css"></style>
