<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTag } from 'naive-ui'
import { taskDate, taskKind, taskLabels, type TaskGroup } from './task-groups'
const props = defineProps<{ task: TaskGroup }>()
defineEmits<{
  navigate: []
  download: [id: string, action: 'pause' | 'resume' | 'cancel']
}>()
const records = computed(() => [...props.task.records].reverse())
const tone = computed(() => {
  if (props.task.needsApproval || props.task.state === 'paused') return 'warning'
  if (['failed', 'interrupted', 'unavailable'].includes(props.task.state)) return 'error'
  return props.task.active ? 'info' : 'default'
})
const targetLabel = computed(() => {
  if (props.task.primary.owner === 'download') return '打开模型库'
  if (props.task.primary.sessionId) return '打开会话'
  return '打开工作区'
})
</script>
<template>
  <article class="task-card" :aria-label="task.title">
    <div class="task-card-heading">
      <h3 :title="task.title">{{ task.title }}</h3>
      <NTag size="small" :bordered="false" :type="tone">{{
        taskLabels[task.state] ?? task.state
      }}</NTag>
    </div>
    <div class="task-card-meta">
      <span>{{ task.kind }}</span>
      <time v-if="task.createdAt">{{ taskDate(task.createdAt) }}</time>
    </div>
    <p v-if="task.phase" class="task-phase">{{ task.phase }}</p>
    <p v-if="task.primary.errorCode" class="task-error">{{ task.primary.errorCode }}</p>
    <div class="task-card-actions">
      <RouterLink :to="task.target" @click="$emit('navigate')">{{ targetLabel }}</RouterLink>
      <div v-if="task.primary.owner === 'download'" class="download-actions">
        <NButton
          v-if="['paused', 'failed'].includes(task.state)"
          size="tiny"
          @click="$emit('download', task.primary.id, 'resume')"
          >继续下载</NButton
        >
        <NButton
          v-if="['queued', 'downloading', 'verifying'].includes(task.state)"
          size="tiny"
          @click="$emit('download', task.primary.id, 'pause')"
          >暂停</NButton
        >
        <NButton
          v-if="!['available', 'cancelled'].includes(task.state)"
          size="tiny"
          @click="$emit('download', task.primary.id, 'cancel')"
          >取消下载</NButton
        >
      </div>
    </div>
    <details v-if="records.length > 1" class="task-records">
      <summary>{{ records.length }} 条执行记录</summary>
      <ol>
        <li v-for="(record, index) in records" :key="`${record.owner}:${record.id}`">
          <span>{{ index + 1 }}. {{ taskKind(record) }}</span>
          <time>{{ taskDate(record.createdAt) }}</time>
          <span :title="record.errorCode ?? undefined">{{
            taskLabels[record.state] ?? record.state
          }}</span>
        </li>
      </ol>
    </details>
  </article>
</template>
<style scoped src="./TaskGroupCard.styles.css"></style>
