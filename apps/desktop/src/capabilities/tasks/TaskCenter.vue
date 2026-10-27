<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NAlert,
  NSpace,
  NSpin,
  NRadioGroup,
  NRadioButton,
} from 'naive-ui'
import { useTaskCenter } from './store'
import StudioIcon from '../../shared/components/StudioIcon.vue'
import TaskGroupCard from './TaskGroupCard.vue'
const state = useTaskCenter(),
  open = ref(false)
const filter = ref('all'),
  limit = ref(10)
const filtered = computed(() =>
  state.groups.filter((task) => filter.value === 'all' || task.active),
)
const visible = computed(() => filtered.value.slice(0, limit.value))
watch(filter, () => {
  limit.value = 10
})
const summary = computed(() =>
  state.error
    ? '任务中心：任务状态更新失败'
    : `任务中心：${state.active.length} 个进行中，${state.approvals.length} 个待批准`,
)
const indicator = computed(() => {
  const count = state.approvals.length || state.active.length
  return count > 99 ? '99+' : String(count)
})
function showTasks(): void {
  open.value = true
  void state.refresh()
}
onMounted(state.start)
onBeforeUnmount(state.stop)
</script>
<template>
  <NButton
    quaternary
    class="task-center-button"
    :title="summary"
    :aria-label="summary"
    :aria-expanded="open"
    aria-haspopup="dialog"
    @click="showTasks"
  >
    <StudioIcon name="tasks" :size="21" />
    <span
      v-if="state.active.length || state.approvals.length"
      class="task-indicator"
      :class="{ 'approval-indicator': state.approvals.length }"
      aria-hidden="true"
      >{{ indicator }}</span
    >
  </NButton>
  <NDrawer v-model:show="open" width="min(600px, 100vw)"
    ><NDrawerContent title="任务中心" closable>
      <div class="task-toolbar">
        <NRadioGroup v-model:value="filter" size="small" aria-label="筛选任务">
          <NRadioButton value="all">全部 {{ state.groups.length }}</NRadioButton>
          <NRadioButton value="active">进行中 {{ state.active.length }}</NRadioButton>
        </NRadioGroup>
        <NButton text size="small" :loading="state.loading" @click="state.refresh">刷新</NButton>
      </div>
      <NAlert v-if="state.error" type="error">
        <NSpace vertical>
          <span>{{ state.error }}</span>
          <small v-if="state.items.length">以下为上次读取的任务，状态可能已变化。</small>
          <NButton size="small" :loading="state.loading" @click="state.refresh">重试</NButton>
        </NSpace>
      </NAlert>
      <p v-else-if="state.loading && !state.loaded" role="status">
        <NSpin size="small" /> 正在加载任务…
      </p>
      <p v-else-if="state.loaded && !state.items.length">暂无任务</p>
      <p v-else-if="state.loaded && !state.error && !filtered.length">没有符合筛选条件的任务</p>
      <div class="task-list">
        <TaskGroupCard
          v-for="task in visible"
          :key="task.key"
          :task="task"
          @navigate="open = false"
          @download="state.download"
        />
      </div>
      <NButton
        v-if="filtered.length > visible.length"
        block
        quaternary
        class="task-more"
        @click="limit += 10"
        >显示更多任务（剩余 {{ filtered.length - visible.length }}）</NButton
      >
    </NDrawerContent></NDrawer
  >
</template>
<style scoped>
.task-center-button {
  position: relative;
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: 11px;
  color: inherit;
}
.task-indicator {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 14px;
  padding: 1px 3px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 14px;
  color: var(--surface-body);
  background: var(--text-primary);
}
.approval-indicator {
  background: var(--status-warning);
}
.task-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.task-list {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}
.task-more {
  margin-top: 12px;
}
@media (max-width: 400px) {
  .task-center-button {
    width: 34px;
  }
}
</style>
