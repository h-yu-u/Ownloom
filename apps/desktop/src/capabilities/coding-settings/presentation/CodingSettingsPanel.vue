<script setup lang="ts">
import { codingLimits } from '@mlx-studio/api-client'
import { onMounted } from 'vue'
import { NAlert, NCard, NFormItem, NInputNumber, NSelect } from 'naive-ui'
import FormActionBar from '../../../shared/ui/FormActionBar.vue'
import { useCodingSettings } from '../store'
const coding = useCodingSettings()
onMounted(() => {
  void coding.load()
})
</script>
<template>
  <NCard title="Coding" style="margin-top: 16px">
    <NAlert v-if="coding.error" type="error">{{ coding.error }}</NAlert>
    <NFormItem label="默认 Coding 模型（与聊天独立）"
      ><NSelect
        v-model:value="coding.draft.defaultModelId"
        :options="coding.models"
        :disabled="coding.pending"
        aria-label="默认 Coding 模型"
    /></NFormItem>
    <NFormItem label="上下文预算（Token）"
      ><NInputNumber
        v-model:value="coding.draft.contextBudget"
        :min="4096"
        :max="codingLimits.contextBudget.maximum"
        :step="4096"
        :disabled="coding.pending"
        aria-label="Coding 上下文预算"
    /></NFormItem>
    <NFormItem label="最多自动修复轮数"
      ><NInputNumber
        v-model:value="coding.draft.maxRepairRounds"
        :min="0"
        :max="codingLimits.maxRepairRounds.maximum"
        :disabled="coding.pending"
        aria-label="最多自动修复轮数"
    /></NFormItem>
    <FormActionBar
      :dirty="coding.dirty"
      :save-pending="coding.savePending"
      :save-disabled-reason="!coding.loaded ? '请先读取配置' : undefined"
      @save="coding.save"
      @reset="coding.reset"
    />
  </NCard>
</template>
