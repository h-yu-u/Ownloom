<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NAlert,
  NButton,
  NEmpty,
  NInput,
  NModal,
  NRadio,
  NUpload,
  type UploadFileInfo,
} from 'naive-ui'
import type { AssetOptionView } from '../application/asset-catalog'
const props = defineProps<{
  show: boolean
  title: string
  options: readonly AssetOptionView[]
  loading: boolean
  pending: boolean
  selectedKey: string | null
  hasMore: boolean
  error?: string
  allowUpload?: boolean
}>()
const emit = defineEmits<{
  close: []
  select: [key: string]
  confirm: []
  more: []
  search: [query: string]
  upload: [file: File]
}>()
const query = ref('')
const visible = computed(() =>
  props.options.filter((option) =>
    `${option.name} ${option.description}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
)
function upload({ file }: { file: UploadFileInfo }): void {
  if (file.file) emit('upload', file.file)
}
</script>
<template>
  <NModal
    :show="show"
    preset="card"
    :title="title"
    style="width: min(620px, 92vw)"
    @close="emit('close')"
    @update:show="!$event && emit('close')"
  >
    <NInput
      v-model:value="query"
      placeholder="筛选已加载的资产"
      aria-label="筛选资产"
      @update:value="emit('search', $event)"
    />
    <NAlert v-if="error" type="error">{{ error }}</NAlert>
    <p v-if="loading" role="status">正在读取资产…</p>
    <NEmpty v-else-if="!visible.length && !error" description="没有匹配资产" />
    <div class="asset-list">
      <label v-for="option in visible" :key="option.key" class="asset-option"
        ><NRadio
          :checked="selectedKey === option.key"
          :disabled="pending || !option.selectable"
          @change="emit('select', option.key)" /><span
          ><strong>{{ option.name }}</strong
          ><small>{{ option.disabledReason ?? option.description }}</small></span
        ><slot name="preview" :option="option"
      /></label>
    </div>
    <div class="asset-actions">
      <NUpload
        v-if="allowUpload"
        :default-upload="false"
        :show-file-list="false"
        accept="image/png,image/jpeg,image/webp"
        :disabled="pending"
        @change="upload"
        ><NButton :loading="pending">上传图片</NButton></NUpload
      ><NButton v-if="hasMore" :loading="loading" @click="emit('more')">加载更多作品</NButton
      ><NButton @click="emit('close')">取消</NButton
      ><NButton
        type="primary"
        :disabled="pending || !selectedKey"
        :loading="pending"
        @click="emit('confirm')"
        >使用所选资产</NButton
      >
    </div>
  </NModal>
</template>
<style scoped>
.asset-list {
  display: grid;
  gap: 12px;
  margin: 16px 0;
  max-height: 45vh;
  overflow-y: auto;
}
.asset-option {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
.asset-option span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}
small {
  display: block;
  color: var(--muted);
  font-size: 12px;
}
.asset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
