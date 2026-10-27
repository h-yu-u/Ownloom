<script setup lang="ts">
import { NButton, NInput, NModal, useDialog, useMessage } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Conversation } from '@mlx-studio/api-client'
import ConversationListItem from '../components/ConversationListItem.vue'
import { visibleConversations as selectConversations } from '../domain/conversation-list'
import { useChatStore } from '../stores/chat.store'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import { useSidebarSearch } from '../../../shared/ui/sidebar-search'

const props = defineProps<{ showConversations: boolean }>()
const chat = useChatStore()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const renameOpen = ref(false)
const renameTarget = ref<Conversation | null>(null)
const renameTitle = ref('')
const { query, showSearch, searchInput, searchButton, closeSearch, toggleSearch } =
  useSidebarSearch()
const navigating = ref(false)
const { pending } = storeToRefs(chat)
const visibleConversations = computed(() =>
  selectConversations(chat.conversations, query.value, showSearch.value ? undefined : 30),
)

watch(
  () => props.showConversations,
  (visible) => {
    if (visible) void chat.loadWorkspace()
    else renameOpen.value = false
  },
  { immediate: true },
)

async function navigateConversation(id?: string): Promise<void> {
  if (pending.value || navigating.value) return
  if (!id) closeSearch()
  navigating.value = true
  try {
    if (id) await chat.openConversation(id)
    else await chat.newConversation()
    await router.push('/chat')
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '无法打开对话')
  } finally {
    navigating.value = false
  }
}
function openRename(item: Conversation): void {
  renameTarget.value = item
  renameTitle.value = item.title
  renameOpen.value = true
}
async function saveRename(): Promise<boolean> {
  if (!renameTarget.value || chat.busy || pending.value) return false
  try {
    await chat.renameConversation(renameTarget.value.id, renameTitle.value)
    return true
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '重命名失败')
    return false
  }
}
function confirmDelete(item: Conversation): void {
  dialog.warning({
    title: '删除对话',
    content: `确定删除「${item.title}」及其全部消息？此操作无法恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (chat.busy || pending.value) return false
      try {
        await chat.deleteConversation(item.id)
      } catch (cause) {
        message.error(cause instanceof Error ? cause.message : '删除失败')
        return false
      }
    },
  })
}
async function togglePin(id: string): Promise<void> {
  try {
    await chat.toggleConversationPin(id)
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '置顶操作失败')
  }
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-chat': showConversations }">
    <div v-if="showConversations" class="sidebar-content">
      <div class="sidebar-heading">
        <RouterLink to="/chat" class="brand">Ownloom</RouterLink>
        <NButton
          ref="searchButton"
          quaternary
          circle
          size="small"
          aria-label="搜索历史对话"
          title="搜索对话"
          :aria-expanded="showSearch"
          @click="toggleSearch"
        >
          <StudioIcon name="search" :size="17" />
        </NButton>
      </div>
      <NButton
        quaternary
        class="new-conversation"
        :disabled="pending || navigating"
        @click="navigateConversation()"
      >
        <StudioIcon name="compose" :size="20" />新对话
      </NButton>
      <NInput
        v-if="showSearch"
        ref="searchInput"
        v-model:value="query"
        class="sidebar-search"
        placeholder="搜索对话"
        size="small"
        clearable
        aria-label="搜索全部对话"
        @keydown.esc.stop.prevent="closeSearch(true)"
        ><template #prefix><StudioIcon name="search" :size="15" /></template
      ></NInput>
      <section class="workspace-nav" :class="{ 'is-searching': showSearch }" aria-label="最近对话">
        <div class="workspace-heading">
          <span>最近对话</span>
        </div>
        <div class="conversation-nav">
          <NButton
            v-if="!chat.conversations.length"
            quaternary
            class="conversation-link"
            :disabled="pending || navigating"
            @click="navigateConversation()"
          >
            <StudioIcon name="chat" :size="17" />新的对话
          </NButton>
          <ConversationListItem
            v-for="item in visibleConversations"
            :key="item.id"
            :conversation="item"
            :active="chat.conversationId === item.id"
            :disabled="pending || navigating"
            @open="navigateConversation(item.id)"
            @rename="openRename(item)"
            @remove="confirmDelete(item)"
            @pin="togglePin(item.id)"
          />
          <p v-if="showSearch && !visibleConversations.length" class="sidebar-empty">
            没有匹配的对话
          </p>
        </div>
      </section>
    </div>
    <NModal
      v-if="showConversations"
      v-model:show="renameOpen"
      preset="dialog"
      title="重命名对话"
      positive-text="保存"
      negative-text="取消"
      :loading="pending"
      :positive-button-props="{ disabled: chat.busy || pending || !renameTitle.trim() }"
      @positive-click="saveRename"
    >
      <NInput
        v-model:value="renameTitle"
        placeholder="输入对话名称"
        aria-label="对话名称"
        :maxlength="160"
        :disabled="pending"
        autofocus
        show-count
      />
    </NModal>
  </aside>
</template>

<style scoped src="./ChatSidebar.styles.css"></style>
