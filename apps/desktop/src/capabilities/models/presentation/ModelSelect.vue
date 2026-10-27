<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NSelect } from 'naive-ui'
import type { ModelOptionView } from '../model-options'
const props = defineProps<{
  options: readonly ModelOptionView[]
  modelValue: string | null
  loading?: boolean
  error?: string | null
  disabled?: boolean
  label?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [id: string]; refresh: [] }>()
const selectOptions = computed(() =>
  props.options.map((item) => ({
    value: item.id,
    label: `${item.label} · ${item.disabledReason ?? item.capabilityLabel}`,
    disabled: item.availability !== 'available',
  })),
)
</script>
<template>
  <div class="model-picker">
    <NSelect
      :value="modelValue"
      :options="selectOptions"
      :loading="loading"
      :disabled="disabled"
      :aria-label="label ?? '选择模型'"
      placeholder="选择本地模型"
      @update:value="emit('update:modelValue', $event)"
    />
    <p v-if="error" role="alert">
      {{ error }} <NButton text @click="emit('refresh')">重新读取模型</NButton>
    </p>
  </div>
</template>
<style scoped>
.model-picker {
  min-width: 0;
  width: 100%;
}
p {
  color: var(--status-error);
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
