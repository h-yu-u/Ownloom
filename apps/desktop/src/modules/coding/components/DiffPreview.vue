<script setup lang="ts">
import { computed } from 'vue'
import { renderDiff } from '../infrastructure/diff-preview'
import 'diff2html/bundles/css/diff2html.min.css'
const props = withDefaults(defineProps<{ patch: string; split?: boolean; fileList?: boolean }>(), {
  split: false,
  fileList: false,
})
const rendered = computed(() => renderDiff(props.patch, props.split, props.fileList))
function navigate(event: MouseEvent): void {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null
  if (!link) return
  event.preventDefault()
  const id = link.getAttribute('href')?.slice(1)
  const root = event.currentTarget
  if (id && root instanceof HTMLElement)
    Array.from(root.querySelectorAll('[id]'))
      .find((element) => element.id === id)
      ?.scrollIntoView({ block: 'start' })
}
</script>
<template>
  <!-- Diff2Html output is sanitized with DOMPurify before insertion. -->
  <!-- eslint-disable vue/no-v-html -->
  <div class="diff-preview" aria-label="代码差异" @click="navigate" v-html="rendered" />
  <!-- eslint-enable vue/no-v-html -->
</template>
<style scoped>
.diff-preview {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 12px;
  font-size: 12px;
}
.diff-preview :deep(.d2h-wrapper) {
  color: var(--text-primary);
  text-align: left;
}
.diff-preview :deep(.d2h-file-header),
.diff-preview :deep(.d2h-code-linenumber),
.diff-preview :deep(.d2h-code-side-linenumber) {
  background: var(--surface-sidebar);
  color: var(--muted);
  border-color: var(--line);
}
.diff-preview :deep(.d2h-file-wrapper),
.diff-preview :deep(.d2h-file-header) {
  border-color: var(--line);
}
.diff-preview :deep(.d2h-info),
.diff-preview :deep(.d2h-code-side-emptyplaceholder),
.diff-preview :deep(.d2h-emptyplaceholder) {
  background: var(--surface-hover);
  color: var(--muted);
  border-color: var(--line);
}
.diff-preview :deep(.d2h-ins) {
  background: color-mix(in srgb, var(--status-success) 13%, transparent);
  border-color: color-mix(in srgb, var(--status-success) 21%, transparent);
}
.diff-preview :deep(.d2h-del) {
  background: color-mix(in srgb, var(--status-error) 13%, transparent);
  border-color: color-mix(in srgb, var(--status-error) 21%, transparent);
}
.diff-preview :deep(ins) {
  background: color-mix(in srgb, var(--status-success) 21%, transparent);
}
.diff-preview :deep(del) {
  background: color-mix(in srgb, var(--status-error) 21%, transparent);
}
.diff-preview :deep(.d2h-file-name),
.diff-preview :deep(.d2h-file-list-title) {
  color: var(--text-primary);
}
.diff-preview :deep(.d2h-code-line-ctn) {
  white-space: pre;
}
.diff-preview :deep(.d2h-file-collapse) {
  display: none;
}
</style>
