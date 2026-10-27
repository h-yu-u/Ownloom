<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NDropdown, NInput, type DropdownOption } from 'naive-ui'
import { useSidebarSearch } from '../../../shared/ui/sidebar-search'
import SessionListItem from '../../../shared/ui/SessionListItem.vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import type { CodingProject, CodingSession } from '../application/ports'
const props = defineProps<{
  projects: CodingProject[]
  sessions: CodingSession[]
  projectId: string
  sessionId: string
  activeSession?: string
  pending: boolean
  hasMore?: boolean
}>()
const emit = defineEmits<{
  project: [id: string]
  open: []
  more: []
  create: []
  session: [id: string]
  rename: [item: CodingSession]
  pin: [item: CodingSession]
  archive: [item: CodingSession]
  remove: [item: CodingSession]
}>()
const archived = ref(false),
  projectMenuOpen = ref(false),
  listMenuOpen = ref(false)
const { query, showSearch, searchInput, searchButton, closeSearch, toggleSearch } =
  useSidebarSearch()
const project = computed(() => props.projects.find((item) => item.id === props.projectId))
const projectOptions = computed<DropdownOption[]>(() => [
  ...props.projects.map((item) => ({ label: item.name, key: `project:${item.id}` })),
  ...(props.projects.length ? [{ type: 'divider' as const, key: 'divider' }] : []),
  { label: '打开项目…', key: 'open' },
])
const visible = computed(() =>
  [...props.sessions]
    .filter(
      (item) =>
        item.archived === archived.value &&
        item.title.toLowerCase().includes(query.value.trim().toLowerCase()),
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
)
watch(
  () => props.projectId,
  () => {
    archived.value = false
    closeSearch()
  },
)
function selectProject(key: string): void {
  if (key === 'open') emit('open')
  else if (key.startsWith('project:')) emit('project', key.slice(8))
}
function createSession(): void {
  archived.value = false
  closeSearch()
  emit('create')
}
function sessionAction(key: string, item: CodingSession): void {
  if (key === 'rename') emit('rename', item)
  if (key === 'pin') emit('pin', item)
  if (key === 'archive') emit('archive', item)
  if (key === 'delete') emit('remove', item)
}
</script>
<template>
  <aside class="coding-sidebar" aria-label="Coding 项目与会话">
    <header class="sidebar-heading">
      <h2>Coding</h2>
      <div class="heading-actions">
        <NButton
          ref="searchButton"
          quaternary
          circle
          size="small"
          aria-label="搜索开发会话"
          title="搜索会话"
          :aria-expanded="showSearch"
          :disabled="!projectId"
          @click="toggleSearch"
          ><StudioIcon name="search" :size="17"
        /></NButton>
        <NDropdown
          v-model:show="listMenuOpen"
          trigger="click"
          :options="[{ key: 'archived', label: archived ? '返回最近会话' : '查看归档' }]"
          @select="archived = !archived"
          ><NButton
            quaternary
            circle
            size="small"
            aria-label="会话列表选项"
            title="会话列表选项"
            :aria-expanded="listMenuOpen"
            ><StudioIcon name="more" :size="18" /></NButton
        ></NDropdown>
      </div>
    </header>
    <NDropdown
      v-model:show="projectMenuOpen"
      trigger="click"
      :options="projectOptions"
      :value="`project:${projectId}`"
      :disabled="pending"
      scrollable
      @select="selectProject"
      ><NButton
        class="project-switcher"
        quaternary
        :disabled="pending"
        aria-label="切换开发项目"
        :aria-expanded="projectMenuOpen"
        :title="project?.path ?? '打开本地项目'"
        ><StudioIcon name="folder" :size="17" /><span>{{ project?.name ?? '打开本地项目' }}</span
        ><StudioIcon name="down" :size="13" /></NButton
    ></NDropdown>
    <NInput
      v-if="showSearch"
      ref="searchInput"
      v-model:value="query"
      size="small"
      placeholder="搜索会话"
      aria-label="搜索开发会话名称"
      clearable
      @keydown.esc.stop.prevent="closeSearch(true)"
      ><template #prefix><StudioIcon name="search" :size="15" /></template
    ></NInput>
    <nav class="session-nav" aria-label="开发会话">
      <div class="list-heading">
        <span>{{ archived ? '已归档' : '会话' }}</span>
        <NButton
          quaternary
          circle
          size="small"
          :disabled="!projectId || pending"
          aria-label="新建开发会话"
          title="新建会话"
          @click="createSession"
          ><StudioIcon name="compose" :size="17"
        /></NButton>
      </div>
      <div class="session-list">
        <SessionListItem
          v-for="item in visible"
          :id="item.id"
          :key="item.id"
          :title="item.title"
          :selected="item.id === sessionId"
          :pending="pending"
          :status="item.id === activeSession ? 'running' : undefined"
          :actions="[
            { key: 'rename', label: '重命名' },
            { key: 'pin', label: item.pinned ? '取消置顶' : '置顶' },
            {
              key: 'archive',
              label: item.archived ? '恢复' : '归档',
              disabled: item.id === activeSession,
            },
            { key: 'delete', label: '删除', disabled: item.id === activeSession, danger: true },
          ]"
          @select="emit('session', item.id)"
          @action="({ key }) => sessionAction(key, item)"
          ><template v-if="item.pinned" #leading
            ><span class="pinned-marker" role="img" aria-label="已置顶"
              ><StudioIcon name="pin" :size="13" /></span></template
        ></SessionListItem>
        <NButton
          v-if="hasMore"
          quaternary
          size="small"
          class="load-more"
          :disabled="pending"
          @click="emit('more')"
          >加载更多</NButton
        >
        <p v-if="!visible.length" class="sidebar-empty">
          {{
            !projectId
              ? '打开项目，开始开发'
              : query.trim()
                ? '没有匹配的会话'
                : archived
                  ? '暂无归档会话'
                  : '还没有会话，点击上方新建'
          }}
        </p>
      </div>
    </nav>
  </aside>
</template>
<style scoped src="./CodingSidebar.styles.css"></style>
