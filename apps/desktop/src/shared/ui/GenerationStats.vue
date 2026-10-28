<script setup lang="ts">
import { computed } from 'vue'
import type { GenerationStatsView } from '../lib/generation-stats'

const props = defineProps<{ stats?: GenerationStatsView | null; streaming?: boolean }>()
const collecting = computed(
  () =>
    props.streaming && props.stats?.generationTokens != null && props.stats.generationTokens <= 1,
)
const speed = computed(() => props.stats?.generationTps?.toFixed(1) ?? '—')
</script>

<template>
  <p
    v-if="stats"
    class="generation-stats"
    aria-label="模型生成统计"
    aria-live="off"
    title="模型引擎报告的本次累计平均生成速度。"
  >
    {{ streaming ? '当前平均生成速度' : '平均生成速度' }}
    <span v-if="collecting">统计中</span>
    <span v-else>{{ speed }} tok/s</span>
    <span aria-hidden="true"> · </span>输出 {{ stats.generationTokens ?? '—' }} tokens
  </p>
</template>

<style scoped>
.generation-stats {
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
  margin: 8px 0 0;
}
</style>
