<script setup lang="ts">
import { computed } from 'vue'
import type { GenerationStatsView } from '../lib/generation-stats'

const props = defineProps<{ stats?: GenerationStatsView | null; streaming?: boolean }>()
const collecting = computed(
  () =>
    props.streaming && props.stats?.generationTokens != null && props.stats.generationTokens <= 1,
)
const speed = computed(() => props.stats?.generationTps?.toFixed(1) ?? '—')
const draft = computed(() => {
  const mode = props.stats?.draftMode
  return mode ? { none: '本轮未使用草稿', mtp: 'MTP 草稿', dflash2: 'DFlash2 草稿' }[mode] : null
})
const details = computed(() => {
  const stats = props.stats
  if (!stats) return []
  const values = [
    { label: '输入总量', value: stats.promptTokens, unit: 'tokens', title: '包含缓存复用的输入。' },
    {
      label: '缓存复用',
      value: stats.cachedTokens,
      unit: 'tokens',
      title: '本轮复用的已计算输入。',
    },
    {
      label: '本轮输入处理',
      value: stats.prefillTokens,
      unit: 'tokens',
      title: '本轮实际重新处理的输入。',
    },
    {
      label: '首字等待',
      value: stats.firstTokenMs,
      unit: 'ms',
      title: '本轮生成开始至首个可见文本，不含排队、模型加载和联网准备。',
    },
    {
      label: '输入准备',
      value: stats.prefillMs,
      unit: 'ms',
      title: '本轮生成开始至首个原生 token，包含模板、缓存处理、预填充与首 token 计算。',
    },
    {
      label: '本轮推理',
      value: stats.durationMs,
      unit: 'ms',
      title: '本轮生成开始至结束，不含排队、模型加载、联网准备或工具执行。',
    },
  ]
  return values.flatMap(({ label, value, unit, title }) =>
    value == null
      ? []
      : [{ label, title, text: unit === 'ms' ? formatDuration(value) : `${value} ${unit}` }],
  )
})

function formatDuration(value: number): string {
  return value < 1000 ? `${Number(value.toFixed(1))} ms` : `${(value / 1000).toFixed(2)} s`
}
</script>

<template>
  <div v-if="stats" class="generation-stats" aria-label="模型生成统计" aria-live="off">
    <p
      class="generation-stats__summary"
      title="模型引擎报告的累计平均生成速度，不包含输入处理时间。"
    >
      {{ streaming ? '当前平均生成速度' : '平均生成速度' }}
      <span v-if="collecting">统计中</span>
      <span v-else>{{ speed }} tok/s</span>
      <span aria-hidden="true"> · </span>输出 {{ stats.generationTokens ?? '—' }} tokens
      <template v-if="draft"><span aria-hidden="true"> · </span>{{ draft }}</template>
    </p>
    <details v-if="details.length" class="generation-stats__details">
      <summary>耗时与输入统计</summary>
      <dl>
        <div v-for="item in details" :key="item.label">
          <dt :title="item.title">{{ item.label }}</dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
    </details>
  </div>
</template>

<style scoped>
.generation-stats {
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
  margin: 8px 0 0;
}

.generation-stats__summary {
  margin: 0;
}

.generation-stats__details {
  margin-top: 4px;
}

.generation-stats__details summary {
  cursor: pointer;
  width: fit-content;
}

.generation-stats__details dl {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin: 6px 0 2px;
}

.generation-stats__details dl > div {
  display: flex;
  gap: 6px;
}

.generation-stats__details dd {
  margin: 0;
}
</style>
