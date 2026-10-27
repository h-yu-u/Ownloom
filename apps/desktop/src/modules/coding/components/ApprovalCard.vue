<script setup lang="ts">
import { NAlert, NButton, NSpace } from 'naive-ui'
import type { CodingApproval } from '../application/ports'
defineProps<{ approval: CodingApproval; pending: boolean }>()
const emit = defineEmits<{ resolve: [id: string, allowed: boolean] }>()
</script>
<template>
  <NAlert
    type="warning"
    :title="approval.action === 'file_write' ? '请求修改测试或验证配置' : '请求执行本地命令'"
  >
    <code>{{ approval.command }}</code>
    <details v-if="approval.action === 'file_write'">
      <summary>审查完整修改参数</summary>
      <pre>{{ JSON.stringify(approval.parameters, null, 2) }}</pre>
    </details>
    <p>目录：{{ approval.cwd }}</p>
    <p>命令以本机用户权限执行，可访问项目以外的文件和网络。此审批仅允许本次命令。</p>
    <NSpace
      ><NButton size="small" :disabled="pending" @click="emit('resolve', approval.id, true)"
        >允许本次</NButton
      ><NButton size="small" :disabled="pending" @click="emit('resolve', approval.id, false)"
        >拒绝</NButton
      ></NSpace
    >
  </NAlert>
</template>
<style scoped>
code,
p {
  overflow-wrap: anywhere;
}
p {
  font-size: 12px;
}
</style>
