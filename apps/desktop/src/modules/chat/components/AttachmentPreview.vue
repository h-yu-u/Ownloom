<script setup lang="ts">
import { NAlert, NButton, NModal, NSpin } from 'naive-ui'
import type { createAttachmentPreviewController } from '../presentation/attachment-preview-controller'
defineProps<{ preview: ReturnType<typeof createAttachmentPreviewController> }>()
</script>
<template>
  <NModal
    :show="Boolean(preview.state.target)"
    preset="card"
    :title="preview.state.target?.originalName"
    style="width: min(900px, 90vw)"
    @update:show="!$event && preview.close()"
  >
    <NSpin :show="preview.state.loading">
      <NAlert v-if="preview.state.error" type="error">{{ preview.state.error }}</NAlert>
      <img
        v-if="preview.state.url"
        :src="preview.state.url"
        :alt="preview.state.target?.originalName"
        class="original-preview"
      />
      <div v-if="preview.state.text" class="document-preview">
        <p>以下为供模型使用的提取内容。</p>
        <NAlert v-if="!preview.state.text.coverage.complete" type="warning"
          >部分内容未读取。需要 OCR 的页：{{
            preview.state.text.coverage.unreadablePages?.join('、') || '见覆盖说明'
          }}</NAlert
        >
        <section v-for="block in preview.state.text.blocks" :key="block.id">
          <small>{{ block.page ? `第 ${block.page} 页` : block.section || block.id }}</small>
          <pre>{{ block.text }}</pre>
        </section>
        <NButton
          v-if="preview.state.text.blocks.length < preview.state.text.totalBlocks"
          :loading="preview.state.loading"
          @click="preview.more()"
          >加载后续内容</NButton
        >
      </div>
    </NSpin>
  </NModal>
</template>
<style scoped>
.original-preview {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: auto;
  object-fit: contain;
}
.document-preview {
  max-height: 70vh;
  overflow: auto;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
small {
  color: var(--muted);
}
</style>
