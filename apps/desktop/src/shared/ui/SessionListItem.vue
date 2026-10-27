<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NDropdown, NInput } from 'naive-ui'
export interface SessionAction {
  key: 'rename' | 'pin' | 'archive' | 'export' | 'delete'
  label: string
  disabled?: boolean
  danger?: boolean
}
const props = defineProps<{
  id: string
  title: string
  selected: boolean
  subtitle?: string
  status?: 'running' | 'error' | 'archived'
  pending?: boolean
  actions: readonly SessionAction[]
  renameError?: string
}>()
const emit = defineEmits<{
  select: [id: string]
  action: [action: { id: string; key: SessionAction['key'] }]
  rename: [value: { id: string; title: string }]
}>()
const menuOpen = ref(false),
  editing = ref(false),
  title = ref(props.title)
const options = computed(() =>
  props.actions.map((item) => ({ ...item, disabled: props.pending || item.disabled })),
)
watch(
  () => props.title,
  (value) => {
    title.value = value
    editing.value = false
  },
)
function action(key: SessionAction['key']): void {
  emit('action', { id: props.id, key })
}
function rename(): void {
  if (title.value.trim() && !props.pending)
    emit('rename', { id: props.id, title: title.value.trim() })
}
defineExpose({
  beginRename: () => {
    title.value = props.title
    editing.value = true
  },
})
</script>
<template>
  <div class="session-row" :class="{ selected, 'menu-open': menuOpen }">
    <slot name="leading" />
    <div class="session-content">
      <NInput
        v-if="editing"
        v-model:value="title"
        autofocus
        :disabled="pending"
        aria-label="会话名称"
        @keydown.enter.prevent="rename"
        @keydown.esc="editing = false"
      />
      <button
        v-else
        class="session-title"
        :title="title"
        :aria-current="selected ? 'true' : undefined"
        :disabled="pending"
        @click="emit('select', id)"
      >
        {{ title }}
      </button>
      <small v-if="subtitle">{{ subtitle }}</small
      ><small v-if="status">{{
        status === 'running' ? '正在运行' : status === 'error' ? '执行失败' : '已归档'
      }}</small>
      <p v-if="renameError" role="alert">{{ renameError }}</p>
    </div>
    <div class="session-actions">
      <NDropdown
        v-if="actions.length"
        v-model:show="menuOpen"
        trigger="click"
        :options="options"
        @select="action"
        ><NButton
          quaternary
          circle
          size="small"
          :disabled="pending"
          :aria-label="`会话操作：${title}`"
          :aria-expanded="menuOpen"
          >⋯</NButton
        ></NDropdown
      ><slot name="trailing" />
    </div>
  </div>
</template>
<style scoped>
.session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--radius-control);
  padding: 8px;
  min-width: 0;
}
.session-row:hover,
.selected,
.menu-open {
  background: var(--surface-hover);
}
.session-content {
  flex: 1;
  min-width: 0;
}
.session-title {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  font: inherit;
}
.session-actions {
  display: flex;
  align-items: center;
}
small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
p {
  color: var(--status-error);
}
</style>
