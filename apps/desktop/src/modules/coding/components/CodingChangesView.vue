<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { NButton, NEmpty, NPopconfirm, NRadioButton, NRadioGroup, NSpace } from 'naive-ui'
import type { CodingChange, CodingChanges } from '../application/ports'
import { latestChanges } from '../domain/inspector'
import { changePatch } from '../infrastructure/diff-preview'
const props = defineProps<{
  changes: CodingChanges | null
  selected: CodingChange | null
  loading: boolean
  busy: boolean
  hasMore?: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  restore: [id: string]
  read: [path: string]
  more: []
}>()
const scope = ref<'session' | 'workspace'>('session')
const split = ref(false)
const entries = computed(() => latestChanges(props.changes?.managed ?? []))
const workspace = computed(() => scope.value === 'workspace')
const patch = computed(() =>
  workspace.value
    ? (props.changes?.diff ?? '')
    : props.selected
      ? changePatch(props.selected.path, props.selected.before, props.selected.after)
      : '',
)
function changeLabel(change: CodingChange): string {
  if (change.state === 'pending') return '写入待确认'
  const first = props.changes?.managed.find((item) => item.path === change.path && !item.restored)
  return first?.before === null ? 'A' : 'M'
}
const DiffPreview = defineAsyncComponent(() => import('./DiffPreview.vue'))
</script>
<template>
  <div class="changes-view">
    <header>
      <NRadioGroup v-model:value="scope" size="small" aria-label="变更范围">
        <NRadioButton value="session">本会话</NRadioButton
        ><NRadioButton value="workspace">Git 工作区</NRadioButton>
      </NRadioGroup>
      <NButton size="tiny" quaternary :aria-pressed="split" @click="split = !split">{{
        split ? '并排' : '行内'
      }}</NButton>
    </header>
    <div class="changes-content">
      <nav v-if="!workspace && entries.length" aria-label="已更改的文件">
        <button
          v-for="change in entries"
          :key="change.id"
          :class="{ selected: selected?.path === change.path }"
          :aria-pressed="selected?.path === change.path"
          :title="change.path"
          @click="emit('select', change.id)"
        >
          <span>{{ change.path }}</span
          ><small>{{ changeLabel(change) }}</small>
        </button>
        <NButton v-if="hasMore" :disabled="loading" @click="emit('more')">加载更早变更</NButton>
      </nav>
      <section>
        <NSpace
          v-if="selected && !workspace"
          class="change-actions"
          justify="space-between"
          align="center"
        >
          <NButton size="tiny" text @click="emit('read', selected.path)">打开文件</NButton>
          <NPopconfirm
            :disabled="busy || loading || selected.state !== 'written'"
            @positive-click="emit('restore', selected.id)"
          >
            <template #trigger
              ><NButton
                size="tiny"
                quaternary
                :disabled="busy || loading || selected.state !== 'written'"
                >撤销最近一次修改</NButton
              ></template
            >
            仅撤销此文件最近一次受管修改；文件已有其他修改时会保留当前内容。
          </NPopconfirm>
        </NSpace>
        <DiffPreview v-if="patch" :patch="patch" :split="split" :file-list="workspace" />
        <NEmpty
          v-else
          :description="
            loading
              ? '正在读取变更…'
              : workspace
                ? '暂无 Git 差异'
                : entries.length
                  ? '选择文件查看差异'
                  : '本会话暂无文件变更'
          "
        />
      </section>
    </div>
  </div>
</template>
<style scoped>
.changes-view {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}
header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--line);
}
.changes-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 110px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  padding: 8px;
  overflow-y: auto;
}
nav button {
  display: flex;
  align-items: start;
  gap: 6px;
  padding: 8px;
  max-width: 100%;
  text-align: left;
  color: var(--text-primary);
  border: 0;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
nav span {
  flex: 1;
  overflow-wrap: anywhere;
}
nav small {
  color: var(--muted);
  font-size: 10px;
}
nav button:hover,
nav button.selected {
  background: var(--surface-hover);
}
section {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
section :deep(.n-empty) {
  margin: auto;
  padding: 20px;
}
.change-actions {
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
}
</style>
