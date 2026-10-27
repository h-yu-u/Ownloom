<script setup lang="ts">
import { computed } from 'vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'

const props = defineProps<{
  systemMemory: string
  memoryPercent: number | null
  workerMemory: string
  diskFree: string
}>()
const percentage = computed(() =>
  props.memoryPercent === null ? '—' : `${props.memoryPercent.toFixed(1)}%`,
)
</script>

<template>
  <section class="panel resource-panel" aria-label="本机资源">
    <div class="device-label">
      <StudioIcon name="monitor" :size="22" /><span>本地运行 · Apple Silicon</span>
    </div>
    <div class="resource-row memory-row" title="已用 / 总内存；排除文件缓存和可回收内存">
      <span>系统内存</span><span>{{ systemMemory }}</span>
    </div>
    <div
      class="resource-track"
      role="progressbar"
      aria-label="系统内存使用率"
      :aria-valuenow="memoryPercent ?? undefined"
      :aria-valuetext="percentage"
      :aria-valuemin="0"
      :aria-valuemax="100"
    >
      <span :style="{ width: `${memoryPercent ?? 0}%` }" />
    </div>
    <div class="resource-row usage-row">
      <span>使用率</span><span>{{ percentage }}</span>
    </div>
    <div
      class="resource-row"
      title="macOS 推理 Worker 的当前物理占用（含压缩内存），不等于专属显存或整个 App 占用"
    >
      <span>推理进程</span><span>{{ workerMemory }}</span>
    </div>
    <div class="resource-row">
      <span>可用磁盘</span><span>{{ diskFree }}</span>
    </div>
    <p class="device-footnote">模型推理在本机进行；外部能力按需启用</p>
  </section>
</template>

<style scoped>
.resource-panel {
  padding: 19px 16px 13px;
}
.device-label {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  margin-bottom: 18px;
}
.device-label svg {
  flex-shrink: 0;
  color: var(--text-primary);
}
.resource-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  margin: 10px 0;
  font-variant-numeric: tabular-nums;
}
.resource-row span:last-child {
  white-space: nowrap;
}
.memory-row {
  flex-wrap: wrap;
  color: var(--text-secondary);
}
.usage-row {
  margin: 7px 0 14px;
  font-size: 12px;
  color: var(--muted);
}
.resource-track {
  height: 5px;
  border-radius: 8px;
  background: var(--border-strong);
  overflow: hidden;
}
.resource-track span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--text-primary), var(--text-primary));
  transition: width 0.3s ease;
}
.device-footnote {
  color: var(--text-tertiary);
  font-size: 12px;
  margin: 14px 0 0;
}
@media (prefers-reduced-motion: reduce) {
  .resource-track span {
    transition: none;
  }
}
</style>
