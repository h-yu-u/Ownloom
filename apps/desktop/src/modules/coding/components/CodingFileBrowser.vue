<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { NEmpty, NInput, NTree, type TreeOption } from 'naive-ui'
import { fileTree } from '../domain/inspector'
const props = defineProps<{
  files: string[]
  path: string
  content: string | null
  loading: boolean
}>()
const emit = defineEmits<{ read: [path: string] }>()
const query = ref('')
const tree = computed(() => fileTree(props.files, query.value))
const CodePreview = defineAsyncComponent(() => import('./CodePreview.vue'))
function select(keys: (string | number)[], options: (TreeOption | null)[]): void {
  if (options[0]?.isLeaf && typeof keys[0] === 'string') emit('read', keys[0])
}
</script>
<template>
  <div class="file-browser">
    <nav aria-label="项目文件树">
      <NInput
        v-model:value="query"
        size="small"
        placeholder="查找文件…"
        aria-label="查找项目文件"
        clearable
      />
      <NTree
        v-if="tree.length"
        :key="query"
        :data="tree"
        block-line
        expand-on-click
        :default-expand-all="!!query"
        :selected-keys="path ? [path] : []"
        @update:selected-keys="select"
      />
      <NEmpty v-else size="small" :description="query ? '未找到匹配文件' : '暂无项目文件'" />
    </nav>
    <section aria-label="文件预览">
      <header v-if="path">
        <span :title="path">{{ path }}</span
        ><small>只读 · ⌘/Ctrl + F 查找</small>
      </header>
      <CodePreview v-if="content !== null" :path="path" :content="content" />
      <NEmpty v-else :description="loading && path ? '正在读取文件…' : '选择一个文件查看内容'" />
    </section>
  </div>
</template>
<style scoped>
.file-browser {
  display: flex;
  flex: 1;
  min-height: 0;
}
nav {
  width: 180px;
  flex-shrink: 0;
  overflow: auto;
  padding: 12px;
  border-right: 1px solid var(--line);
}
nav :deep(.n-tree) {
  margin-top: 12px;
  font-size: 12px;
}
nav :deep(.n-empty) {
  margin-top: 24px;
}
section {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
header {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}
header span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
small {
  color: var(--muted);
  font-size: 10px;
}
section :deep(.n-empty) {
  margin: auto;
  padding: 20px;
}
@media (max-width: 800px) {
  nav {
    width: 130px;
    padding: 8px;
  }
}
</style>
