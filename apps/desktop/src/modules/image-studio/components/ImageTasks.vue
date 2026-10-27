<script setup lang="ts">
import { NButton, NTag } from 'naive-ui'
import { isTerminal, type ImageJob } from '../domain/image-state'
import { imageJobError } from '../presentation/image-feedback'

defineProps<{ jobs: ImageJob[]; locked: boolean }>()
defineEmits<{ reuse: [job: ImageJob]; select: [id: string] }>()
const labels = {
  queued: '排队中',
  preparing: '准备中',
  running: '生成中',
  cancelling: '取消中',
  succeeded: '已保存',
  failed: '失败',
  cancelled: '已取消',
}
</script>

<template>
  <section v-if="jobs.length" class="panel image-task-list" aria-label="最近生成任务">
    <h2>最近任务</h2>
    <div v-for="job in jobs.slice(0, 5)" :key="job.id" class="image-task-row">
      <div class="task-description">
        <strong>{{ job.prompt }}</strong
        ><span>{{
          job.state === 'failed'
            ? imageJobError(job.error_code)
            : `${job.width} × ${job.height} · ${job.steps} 步 · Seed ${job.seed}`
        }}</span>
      </div>
      <NTag
        size="small"
        :bordered="false"
        :type="job.state === 'failed' ? 'error' : job.state === 'succeeded' ? 'success' : 'default'"
      >
        {{ labels[job.state] }}
      </NTag>
      <NButton
        v-if="job.state === 'succeeded' && job.artifact_id"
        text
        size="small"
        @click="$emit('select', job.artifact_id)"
      >
        查看作品
      </NButton>
      <NButton
        v-else-if="isTerminal(job)"
        text
        size="small"
        :disabled="locked"
        @click="$emit('reuse', job)"
      >
        复用参数
      </NButton>
    </div>
  </section>
</template>

<style scoped>
.image-task-list {
  margin-top: 22px;
  padding: 18px 20px;
}
.image-task-list h2 {
  font-size: 14px;
  font-weight: 550;
  margin: 0 0 13px;
}
.image-task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--surface-hover);
}
.task-description {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 5px;
}
.task-description strong {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-description span {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.5;
}
.image-task-row > .n-button,
.image-task-row > .n-tag {
  flex-shrink: 0;
}
</style>
