<script setup lang="ts">
import { NButton } from 'naive-ui'
import SessionListItem from '../../../shared/ui/SessionListItem.vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
defineProps<{
  conversation: { id: string; title: string; pinned?: boolean }
  active: boolean
  disabled: boolean
}>()
const emit = defineEmits<{ open: []; rename: []; remove: []; pin: [] }>()
function action({ key }: { key: string }): void {
  if (key === 'rename') emit('rename')
  if (key === 'delete') emit('remove')
}
</script>
<template>
  <SessionListItem
    :id="conversation.id"
    class="conversation-row"
    :title="conversation.title"
    :selected="active"
    :pending="disabled"
    :actions="[
      { key: 'rename', label: '重命名' },
      { key: 'delete', label: '删除', danger: true },
    ]"
    @select="emit('open')"
    @action="action"
  >
    <template #trailing
      ><NButton
        quaternary
        circle
        size="small"
        :aria-label="`${conversation.pinned ? '取消置顶' : '置顶'}：${conversation.title}`"
        :aria-pressed="conversation.pinned === true"
        :disabled="disabled"
        @click="emit('pin')"
        ><StudioIcon name="pin" :size="17" /></NButton
    ></template>
  </SessionListItem>
</template>
