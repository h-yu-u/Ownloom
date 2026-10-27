<script setup lang="ts">
import { NButton, NSpace } from 'naive-ui'
defineProps<{
  dirty: boolean
  savePending: boolean
  saveDisabledReason?: string
  savedLabel?: string
  test?: { pending: boolean; disabledReason?: string; label?: string }
}>()
const emit = defineEmits<{ save: []; test: []; reset: [] }>()
</script>
<template>
  <div class="form-actions">
    <p role="status">{{ dirty ? '有未保存更改' : (savedLabel ?? '已保存') }}</p>
    <NSpace
      ><NButton
        type="primary"
        :disabled="!dirty || !!saveDisabledReason || savePending || test?.pending"
        :loading="savePending"
        @click="emit('save')"
        >保存</NButton
      >
      <NButton
        v-if="test"
        :disabled="!!test.disabledReason || savePending || test.pending"
        :loading="test.pending"
        @click="emit('test')"
        >{{ test.label ?? '测试已保存配置' }}</NButton
      >
      <NButton :disabled="!dirty || savePending || test?.pending" @click="emit('reset')"
        >放弃修改</NButton
      ></NSpace
    >
    <p v-if="saveDisabledReason || test?.disabledReason" class="reason">
      {{ saveDisabledReason || test?.disabledReason }}
    </p>
  </div>
</template>
<style scoped>
.form-actions {
  margin-top: 16px;
}
p {
  color: var(--muted);
  font-size: 12px;
}
.reason {
  overflow-wrap: anywhere;
}
</style>
