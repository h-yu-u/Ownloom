<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NProgress, NTag } from 'naive-ui'
import type { TaskStatusView } from './task-status.types'
const props = defineProps<{ status: TaskStatusView }>()
const emit = defineEmits<{ cancel: []; retry: []; reconnect: [] }>()
const percentage = computed(() =>
  props.status.progress && props.status.progress.total > 0
    ? Math.min(
        100,
        Math.max(0, (props.status.progress.completed / props.status.progress.total) * 100),
      )
    : undefined,
)
</script>
<template>
  <section class="task-status" aria-label="当前任务" role="status" aria-live="polite">
    <div class="task-heading">
      <NTag
        :type="
          status.phase === 'failed' ? 'error' : status.phase === 'succeeded' ? 'success' : 'default'
        "
        >{{ status.label }}</NTag
      ><slot />
    </div>
    <p v-if="status.detail">{{ status.detail }}</p>
    <p v-if="status.connection !== 'connected'">
      状态同步中断，最后已知状态：{{ status.label }}
      <NButton text @click="emit('reconnect')">重新同步</NButton>
    </p>
    <p v-if="status.error" class="task-error" role="alert">{{ status.error.message }}</p>
    <NProgress v-if="percentage !== undefined" type="line" :percentage="percentage" />
    <NButton
      v-if="status.canCancel || status.cancelPending || status.phase === 'cancelling'"
      :disabled="!status.canCancel || status.cancelPending || status.phase === 'cancelling'"
      :loading="status.cancelPending"
      @click="emit('cancel')"
      >{{ status.phase === 'cancelling' ? '正在取消' : '停止任务' }}</NButton
    >
    <NButton v-if="status.canRetry" @click="emit('retry')">重新提交</NButton>
  </section>
</template>
<style scoped>
.task-status {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  overflow-wrap: anywhere;
}
.task-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}
p {
  margin: 8px 0;
}
.task-error {
  color: var(--status-error);
}
</style>
