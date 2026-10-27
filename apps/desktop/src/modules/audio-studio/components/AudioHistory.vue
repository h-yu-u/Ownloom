<script setup lang="ts">
import { NButton, NCard, NPopconfirm, NSpace, NTag } from 'naive-ui'
import { computed } from 'vue'
import ResourceListState from '../../../shared/ui/ResourceListState.vue'
import type { AudioArtifact } from '../application/ports'
const props = defineProps<{
  error?: string | null
  savingById?: Record<string, symbol>
  artifacts: AudioArtifact[]
  loading: boolean
  hasMore: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  reuse: [item: AudioArtifact]
  save: [id: string]
  remove: [id: string]
  more: []
  refresh: []
}>()
const phase = computed(() =>
  props.loading
    ? props.artifacts.length
      ? 'refreshing'
      : 'initial-loading'
    : props.error
      ? props.artifacts.length
        ? 'more-error'
        : 'initial-error'
      : props.artifacts.length
        ? 'ready'
        : 'empty',
)
</script>
<template>
  <NSpace vertical :size="16">
    <NButton :loading="loading" @click="emit('refresh')">刷新作品</NButton>
    <ResourceListState
      :phase="phase"
      :error="error"
      :has-more="hasMore"
      empty-title="还没有语音作品"
      @retry="emit('refresh')"
      @load-more="emit('more')"
    >
      <div class="audio-gallery">
        <NCard
          v-for="item in artifacts"
          :key="item.id"
          size="small"
          :title="item.voice_snapshot?.name ?? item.speaker ?? '语音作品'"
        >
          <NSpace vertical>
            <NTag v-if="item.simulated" size="small" type="warning">开发测试音</NTag>
            <p class="artifact-text">{{ item.text }}</p>
            <small>{{ item.model_name }} · {{ item.duration_seconds.toFixed(1) }} 秒</small>
            <small>{{ new Date(item.created_at * 1000).toLocaleString() }}</small>
            <NSpace>
              <NButton size="small" @click="emit('select', item.id)">试听</NButton>
              <NButton
                size="small"
                :loading="!!savingById?.[item.id]"
                :disabled="!!savingById?.[item.id]"
                @click="emit('save', item.id)"
                >导出 WAV</NButton
              >
              <NButton size="small" :disabled="busy" @click="emit('reuse', item)">复用参数</NButton>
              <NPopconfirm @positive-click="emit('remove', item.id)"
                ><template #trigger
                  ><NButton size="small" type="error" quaternary>删除</NButton></template
                >删除此作品及其音频文件？参考音色会保留。</NPopconfirm
              >
            </NSpace>
          </NSpace>
        </NCard>
      </div>
    </ResourceListState>
  </NSpace>
</template>
<style scoped>
.audio-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 16px;
}
.artifact-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 100px;
  overflow-y: auto;
}
</style>
