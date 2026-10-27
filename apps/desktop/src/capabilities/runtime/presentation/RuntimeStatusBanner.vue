<script setup lang="ts">
import { NButton, NTooltip, useMessage } from 'naive-ui'
import { computed, ref } from 'vue'
import {
  canRestartRuntime,
  restartRuntimeProcess,
  runtimeConnectionError,
  runtimeConnectionStatus,
} from '../../../platform/runtime-bridge'
import { useRuntimeStore } from '../store'
import { useRuntimePolling } from './use-runtime-polling'

const runtime = useRuntimeStore()
useRuntimePolling(runtime.poll)
defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ reconnected: [] }>()
const message = useMessage()
const retrying = ref(false)
const status = computed(() => (runtime.error ? 'failed' : runtimeConnectionStatus.value))
const text = computed(
  () =>
    ({ starting: 'Runtime 启动中', ready: 'Runtime 运行中', failed: 'Runtime 未连接' })[
      status.value
    ],
)
async function retry(): Promise<void> {
  retrying.value = true
  try {
    if (canRestartRuntime()) await restartRuntimeProcess()
    await runtime.refresh()
    emit('reconnected')
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '重试失败')
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="runtime-summary">
    <NTooltip>
      <template #trigger>
        <NButton
          v-if="status === 'failed'"
          class="runtime-badge"
          :class="`runtime-${status}`"
          secondary
          :loading="retrying"
          @click="retry"
        >
          <span class="status-dot" :class="`status-${status}`" />{{ text }} · 重试
        </NButton>
        <span v-else class="runtime-badge" :class="`runtime-${status}`" role="status">
          <span class="status-dot" :class="`status-${status}`" />{{ text }}
        </span>
      </template>
      {{ runtime.error || runtimeConnectionError || text }}
    </NTooltip>
    <span class="runtime-memory" aria-label="系统内存使用情况">
      内存 {{ runtime.systemMemory }}
    </span>
  </div>
</template>

<style scoped src="./RuntimeStatus.styles.css"></style>
