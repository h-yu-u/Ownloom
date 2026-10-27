<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { NAlert, NButton } from 'naive-ui'
import type { CodingChange, CodingChanges } from '../application/ports'
import type { InspectorPanel } from '../domain/inspector'
defineProps<{
  panel: InspectorPanel
  changes: CodingChanges | null
  selected: CodingChange | null
  files: string[]
  content: string | null
  path: string
  busy: boolean
  pending: boolean
  error: string | null
  hasMore?: boolean
}>()
const emit = defineEmits<{
  close: []
  panel: [panel: InspectorPanel]
  refresh: []
  more: []
  restore: [id: string]
  detail: [id: string]
  read: [path: string]
}>()
const CodingFileBrowser = defineAsyncComponent(() => import('./CodingFileBrowser.vue'))
const CodingChangesView = defineAsyncComponent(() => import('./CodingChangesView.vue'))
</script>
<template>
  <aside class="coding-inspector" aria-label="项目浏览面板">
    <header>
      <div class="inspector-tabs">
        <NButton
          v-for="item in ['changes', 'files'] as const"
          :key="item"
          text
          :aria-pressed="panel === item"
          :class="{ active: panel === item }"
          @click="panel !== item && emit('panel', item)"
          >{{ item === 'changes' ? '变更' : '文件' }}</NButton
        >
      </div>
      <div>
        <NButton text size="small" :loading="pending" @click="emit('refresh')">刷新</NButton>
        <NButton quaternary circle size="small" aria-label="关闭浏览面板" @click="emit('close')"
          >×</NButton
        >
      </div>
    </header>
    <NAlert v-if="error" type="error" class="inspector-error">{{ error }}</NAlert>
    <CodingFileBrowser
      v-if="panel === 'files'"
      :files="files"
      :content="content"
      :path="path"
      :loading="pending"
      @read="emit('read', $event)"
    />
    <CodingChangesView
      v-else
      :changes="changes"
      :selected="selected"
      :loading="pending"
      :busy="busy"
      :has-more="hasMore"
      @more="emit('more')"
      @select="emit('detail', $event)"
      @restore="emit('restore', $event)"
      @read="emit('read', $event)"
    />
  </aside>
</template>
<style scoped>
.coding-inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--surface-body);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
}
header > div {
  display: flex;
  align-items: center;
  gap: 16px;
}
.inspector-tabs :deep(button) {
  height: 48px;
  font-size: 13px;
  color: var(--muted);
  border-bottom: 2px solid transparent;
}
.inspector-tabs :deep(button.active) {
  color: var(--text-primary);
  border-bottom-color: currentColor;
}
.inspector-error {
  margin: 10px;
  width: auto;
}
</style>
