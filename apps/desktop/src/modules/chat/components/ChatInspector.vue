<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NCollapse, NCollapseItem, NSlider, NSwitch, NTooltip } from 'naive-ui'
import NumericParameterField from '../../../shared/ui/NumericParameterField.vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import { chatOutputLimit } from '../domain/chat-parameters'
interface SelectedModel {
  displayName: string
  engine: string
  inputModalities: string[]
  contextLength?: number | null
}
const props = defineProps<{
  clearing?: boolean
  busy: boolean
  messageCount?: number
  selectedModel?: SelectedModel
  runtime: { error: string | null; info: Record<string, unknown>; uptime: string; diskFree: string }
}>()
const maxTokens = defineModel<number | null>('maxTokens', { default: null })
const temperature = defineModel<number>('temperature', { default: 0.7 })
const outputLimit = computed(() => chatOutputLimit(props.selectedModel?.contextLength))
const automatic = computed({
  get: () => maxTokens.value === null,
  set: (value: boolean) => {
    maxTokens.value = value ? null : Math.min(8192, outputLimit.value)
  },
})
const manualTokens = computed({
  get: () => maxTokens.value ?? outputLimit.value,
  set: (value: number) => {
    maxTokens.value = value
  },
})
const emit = defineEmits<{ clear: []; export: []; reset: [] }>()
function reset(): void {
  emit('reset')
}
</script>

<template>
  <aside class="chat-inspector" aria-label="模型和会话设置">
    <section class="panel inspector-card model-settings">
      <div class="inspector-heading">
        <h2><StudioIcon name="settings" :size="23" />模型设置</h2>
        <NButton text size="tiny" :disabled="busy" @click="reset"> 重置 </NButton>
      </div>
      <div class="parameter-label">
        <span>回答长度</span>
        <NSwitch v-model:value="automatic" :disabled="busy" aria-label="自动使用最大输出长度">
          <template #checked>自动最大</template>
          <template #unchecked>手动</template>
        </NSwitch>
      </div>
      <p v-if="automatic" class="output-help muted" role="status">
        根据模型窗口，自动使用输入和历史之外的剩余空间。
      </p>
      <NumericParameterField
        v-else
        v-model="manualTokens"
        class="output-length"
        label="输出上限（tokens）"
        input-id="max-tokens"
        :min="64"
        :max="outputLimit"
        :step="64"
        :disabled="busy"
      />
      <NumericParameterField
        v-model="temperature"
        label="温度 (Temperature)"
        input-id="temperature"
        :min="0"
        :max="2"
        :step="0.1"
        :precision="1"
        :disabled="busy"
      />
      <NTooltip>
        <template #trigger>
          <div class="parameter-control unavailable-parameter">
            <div class="parameter-label">
              <span>Top P</span><span class="parameter-value">—</span>
            </div>
            <NSlider
              :value="0.9"
              :min="0"
              :max="1"
              :step="0.1"
              disabled
              aria-label="Top P 尚未支持"
            />
          </div>
        </template>
        当前 Runtime 尚未支持 Top P
      </NTooltip>
      <NTooltip>
        <template #trigger>
          <div class="parameter-control unavailable-parameter">
            <div class="parameter-label">
              <span>重复惩罚</span><span class="parameter-value">—</span>
            </div>
            <NSlider :value="1" :min="0" :max="2" disabled aria-label="重复惩罚尚未支持" />
          </div>
        </template>
        当前 Runtime 尚未支持重复惩罚
      </NTooltip>
      <NCollapse class="advanced-settings">
        <NCollapseItem title="高级参数" name="advanced">
          <p>引擎：{{ selectedModel?.engine ?? '—' }}</p>
          <p>输入：{{ selectedModel?.inputModalities.join(' · ') ?? '—' }}</p>
          <p class="muted">Top P 和重复惩罚暂未开放。</p>
        </NCollapseItem>
      </NCollapse>
    </section>
    <section class="panel inspector-card session-info">
      <div class="inspector-heading">
        <h2><StudioIcon name="info" :size="22" />会话信息</h2>
      </div>
      <dl>
        <div>
          <dt>模型名称</dt>
          <dd :title="selectedModel?.displayName">
            {{ selectedModel?.displayName ?? '未选择' }}
          </dd>
        </div>
        <div>
          <dt>运行时</dt>
          <dd>
            <span v-if="!runtime.error && runtime.info.state" class="status-dot" />{{
              runtime.error ? '未连接' : (runtime.info.state ?? '连接中')
            }}
          </dd>
        </div>
        <div>
          <dt>协议版本</dt>
          <dd>{{ runtime.info.protocol_version ?? '—' }}</dd>
        </div>
        <div>
          <dt>上下文长度</dt>
          <dd>{{ selectedModel?.contextLength?.toLocaleString() ?? '—' }}</dd>
        </div>
        <div>
          <dt>已用时长</dt>
          <dd>{{ runtime.uptime }}</dd>
        </div>
        <div>
          <dt>可用磁盘</dt>
          <dd>{{ runtime.diskFree }}</dd>
        </div>
      </dl>
    </section>
  </aside>
</template>

<style scoped src="./ChatInspector.styles.css"></style>
