<script setup lang="ts">
import { NInputNumber, NSlider } from 'naive-ui'
defineProps<{
  label: string
  min: number
  max: number
  step: number
  precision?: number
  disabled?: boolean
  inputId: string
}>()
const value = defineModel<number>({ required: true })
</script>
<template>
  <div class="parameter-control">
    <div class="parameter-label">
      <label :for="inputId">{{ label }}</label>
      <NInputNumber
        :value="value"
        :min="min"
        :max="max"
        :step="step"
        :precision="precision"
        :disabled="disabled"
        :show-button="false"
        :input-props="{ id: inputId, 'aria-label': label }"
        @update:value="value = $event ?? value"
      />
    </div>
    <NSlider
      v-model:value="value"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :aria-label="label"
    />
  </div>
</template>
<style scoped>
.parameter-control {
  margin-bottom: 18px;
}
.parameter-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 11px;
  font-size: 13px;
}
.parameter-label :deep(.n-input-number) {
  width: 54px;
  flex-shrink: 0;
}
</style>
