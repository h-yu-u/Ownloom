<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { mountCodePreview } from '../infrastructure/code-preview'
const props = defineProps<{ content: string; path: string }>()
const host = ref<HTMLElement>()
let dispose: (() => void) | undefined
function render(): void {
  dispose?.()
  if (host.value) dispose = mountCodePreview(host.value, props.content, props.path)
}
onMounted(render)
watch(() => [props.content, props.path], render)
onUnmounted(() => dispose?.())
</script>
<template><div ref="host" class="code-preview" /></template>
<style scoped>
.code-preview {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
