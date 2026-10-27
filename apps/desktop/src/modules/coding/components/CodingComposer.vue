<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NSelect, NDropdown, NPopover, NCheckbox } from 'naive-ui'
import ComposerShell from '../../../shared/ui/ComposerShell.vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import { codingPrimary, type ComposerAction } from '../../../shared/ui/composer-policy'
import { modeOptions, type CodingMode, type CodingPermissionMode } from '../domain/status'
const props = defineProps<{
  modelValue: string
  models: { label: string; value: string }[]
  modelId: string
  verifyAfter?: boolean
  mode: CodingMode
  permissionMode?: CodingPermissionMode
  preparing?: boolean
  ready: boolean
  busy: boolean
  pending: boolean
  enabled: boolean
  currentSessionActive: boolean
  activeStatus?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [text: string]
  model: [id: string]
  mode: [mode: CodingMode]
  permissions: [mode: CodingPermissionMode]
  verify: [enabled: boolean]
  submit: []
  steer: []
  queue: []
  stop: []
}>()
const primary = computed(() =>
  codingPrimary({
    text: props.modelValue,
    enabled: props.enabled,
    ready: props.ready,
    pending: props.pending,
    busy: props.busy,
    current: props.currentSessionActive,
    status: props.activeStatus,
  }),
)
const modeLabel = computed(() => modeOptions.find((item) => item.value === props.mode)?.label)
const permissionLabel = computed(() =>
  props.mode !== 'develop' ? '只读访问' : props.permissionMode === 'full' ? '完全访问' : '需要审批',
)
function selectMode(value: string): void {
  if (value === 'analyze' || value === 'develop' || value === 'review') emit('mode', value)
}
function selectPermissions(value: string): void {
  if (value === 'ask' || value === 'full') emit('permissions', value)
}
function act(action: ComposerAction): void {
  if (action === 'cancel') emit('stop')
  else if (primary.value.enabled) {
    if (action === 'submit') emit('submit')
    if (action === 'queue') emit('queue')
    if (action === 'steer') emit('steer')
  }
}
</script>
<template>
  <ComposerShell
    class="coding-composer"
    :model-value="modelValue"
    :primary="primary"
    :show-reason="false"
    :bordered="false"
    shortcut="modifier-enter"
    label="开发任务"
    placeholder="描述需求，或补充当前任务…"
    :input-disabled="!enabled"
    @update:model-value="emit('update:modelValue', $event)"
    @action="act"
  >
    <template #tools>
      <slot name="capabilities" />
      <NDropdown
        :options="modeOptions.map((item) => ({ label: item.label, key: item.value }))"
        :disabled="busy || pending"
        trigger="click"
        @select="selectMode"
      >
        <NButton size="small" quaternary :disabled="busy || pending" aria-label="开发模式">
          {{ modeLabel }}<StudioIcon name="down" :size="13" />
        </NButton>
      </NDropdown>
      <NSelect
        class="coding-model"
        :value="modelId"
        :options="models"
        :disabled="busy || pending"
        :bordered="false"
        size="small"
        aria-label="Coding 模型"
        @update:value="emit('model', $event)"
      />
      <NDropdown
        :options="[
          { label: '需要审批', key: 'ask' },
          { label: '完全访问', key: 'full' },
        ]"
        trigger="click"
        :disabled="pending || mode !== 'develop' || activeStatus === 'cancelling'"
        @select="selectPermissions"
      >
        <NButton
          size="small"
          quaternary
          :disabled="pending || mode !== 'develop' || activeStatus === 'cancelling'"
          aria-label="访问权限"
          :title="
            permissionMode === 'full'
              ? '命令无需逐次批准，可访问本机文件和网络'
              : '命令及敏感修改需要批准'
          "
        >
          <StudioIcon :name="permissionMode === 'full' ? 'bolt' : 'shield'" :size="15" />{{
            permissionLabel
          }}<StudioIcon name="down" :size="13" />
        </NButton>
      </NDropdown>
      <NPopover trigger="click" placement="top-end">
        <template #trigger
          ><NButton size="small" quaternary circle aria-label="任务选项"
            ><StudioIcon name="more" :size="18" /></NButton
        ></template>
        <NCheckbox
          :checked="verifyAfter"
          :disabled="busy || pending"
          @update:checked="emit('verify', $event)"
          >完成后运行项目验证</NCheckbox
        >
      </NPopover>
    </template>
    <template #actions>
      <NButton
        v-if="preparing || (busy && currentSessionActive)"
        circle
        secondary
        :disabled="activeStatus === 'cancelling'"
        aria-label="停止任务"
        title="停止任务"
        @click="emit('stop')"
        ><StudioIcon name="stop" :size="16"
      /></NButton>
      <NButton
        v-if="!preparing && (!busy || !currentSessionActive || modelValue.trim())"
        circle
        type="primary"
        :disabled="!primary.enabled"
        :loading="primary.pending"
        :aria-label="primary.label"
        :title="primary.reason || primary.label"
        @click="act(primary.action)"
        ><StudioIcon name="up" :size="19"
      /></NButton>
    </template>
    <template #hint
      ><small v-if="busy && !currentSessionActive"
        >其他会话正在运行，新任务将排队。</small
      ></template
    >
  </ComposerShell>
</template>
<style scoped src="./CodingComposer.styles.css"></style>
