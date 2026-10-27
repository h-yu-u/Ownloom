<script setup lang="ts">
import { NButton, NImage } from 'naive-ui'
import { computed } from 'vue'
import { visibleMedia } from '../../../capabilities/media'
import ResourceListState from '../../../shared/ui/ResourceListState.vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import type { ImageArtifact } from '../domain/image-state'

const props = defineProps<{
  artifacts: ImageArtifact[]
  urls: Record<string, string>
  errors: Record<string, string>
  selectedId: string | null
  loading: boolean
  error: string | null
  hasMore: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  refresh: []
  more: []
  visible: [id: string]
  hidden: [id: string]
}>()
const vMediaVisible = visibleMedia(
  (id) => !props.urls[id] && !props.errors[id],
  (id) => emit('visible', id),
  (id) => emit('hidden', id),
)
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
  <section class="image-history" aria-label="作品历史">
    <div class="history-heading">
      <div>
        <h2>
          <StudioIcon name="image" :size="20" />作品历史 <span>{{ artifacts.length }}</span>
        </h2>
        <p>点击缩略图查看大图、保存图片或复用参数。重启应用后仍可找回。</p>
      </div>
      <NButton quaternary size="small" :loading="loading" @click="$emit('refresh')">
        刷新历史
      </NButton>
    </div>
    <ResourceListState
      :phase="phase"
      :error="error"
      :has-more="hasMore"
      empty-title="你的第一张作品，正在等待一个灵感"
      @retry="$emit('refresh')"
      @load-more="$emit('more')"
    >
      <div v-if="artifacts.length" class="history-grid">
        <NButton
          v-for="item in artifacts"
          :key="item.id"
          v-media-visible="item.id"
          quaternary
          class="history-image-card"
          :class="{ selected: selectedId === item.id }"
          :aria-pressed="selectedId === item.id"
          :aria-label="`查看作品：${item.prompt}`"
          @click="errors[item.id] ? $emit('visible', item.id) : $emit('select', item.id)"
        >
          <div class="history-image-cover">
            <NImage
              v-if="urls[item.id]"
              :src="urls[item.id]"
              :alt="item.simulated ? '模拟图片缩略图' : item.prompt"
              object-fit="cover"
              preview-disabled
              :img-props="{ style: 'width:100%;height:150px;object-fit:cover' }"
            />
            <div v-else class="history-image-placeholder">
              <StudioIcon name="image" :size="30" /><span>{{
                errors[item.id] ? '图片读取失败，点击重试' : '读取中…'
              }}</span>
            </div>
            <span v-if="item.simulated" class="simulated-badge">模拟输出</span>
          </div>
          <div class="history-image-caption">
            <strong>{{ item.prompt }}</strong>
            <div>
              <span>{{ item.width }} × {{ item.height }}</span
              ><span>{{ new Date(item.created_at * 1000).toLocaleDateString('zh-CN') }}</span>
            </div>
          </div>
        </NButton>
      </div>
    </ResourceListState>
  </section>
</template>

<style scoped>
.image-history {
  margin-top: 29px;
}
.history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
}
.history-heading h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  margin: 0;
  font-weight: 600;
}
.history-heading h2 svg {
  color: var(--text-primary);
}
.history-heading h2 > span {
  display: grid;
  place-items: center;
  height: 22px;
  min-width: 24px;
  padding: 0 6px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-hover);
  border-radius: 6px;
}
.history-heading p {
  margin: 7px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.6;
}
.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.history-image-card.n-button {
  height: auto;
  display: block;
  padding: 0;
  overflow: hidden;
  text-align: left;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--surface-hover);
}
.history-image-card.selected {
  border-color: var(--text-primary);
}
.history-image-card :deep(.n-button__content) {
  display: block;
  width: 100%;
}
.history-image-cover {
  position: relative;
  height: 150px;
  overflow: hidden;
}
.history-image-cover .n-image {
  width: 100%;
  display: block;
  pointer-events: none;
}
.simulated-badge {
  position: absolute;
  top: 9px;
  left: 9px;
  background: var(--surface-card);
  color: var(--text-primary);
  font-size: 12px;
  padding: 3px 7px;
  border-radius: 5px;
}
.history-image-caption {
  padding: 12px;
}
.history-image-caption strong {
  display: block;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-image-caption > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
  margin-top: 9px;
}
.history-image-placeholder {
  height: 150px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  color: var(--text-tertiary);
  background: var(--surface-card);
  font-size: 12px;
}
.history-empty {
  padding: 40px 20px;
}
.history-empty span {
  color: var(--text-tertiary);
  font-size: 12px;
}
.history-error {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--status-error);
  font-size: 12px;
  margin-bottom: 16px;
}
.history-more {
  display: flex;
  margin: 20px auto 0;
}
@media (max-width: 680px) {
  .history-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .history-heading {
    align-items: start;
  }
  .history-heading h2 {
    font-size: 16px;
  }
  .history-heading .n-button {
    flex-shrink: 0;
  }
  .history-image-caption {
    padding: 10px;
  }
  .history-image-caption > div {
    flex-wrap: wrap;
    gap: 4px;
  }
}
</style>
