<script setup lang="ts">
import { computed, ref, onUnmounted, onMounted, watch } from 'vue'
import { NAlert, NButton, NDrawer, NDrawerContent, NSelect, NSpace, NCard } from 'naive-ui'
import type { ExtensionSelection, AgentChatRequest } from '@mlx-studio/api-client'
import { createAgentChat } from '../configuration'
import CapabilityPicker from './CapabilityPicker.vue'
import TaskStatusPanel from '../../../shared/ui/TaskStatusPanel.vue'
import ComposerShell from '../../../shared/ui/ComposerShell.vue'
import MarkdownContent from '../../../shared/ui/MarkdownContent.vue'
import { useMarkdownCopy } from '../../../shared/ui/markdown-copy'
import { copyText } from '../../../platform/clipboard'
import { agentTaskStatus, agentEventLabel } from './agent-task-status'
import ArtifactLinks from './ArtifactLinks.vue'
const props = defineProps<{
  text?: string
  disabled?: boolean
  standalone?: boolean
  hideTrigger?: boolean
  initialSessionId?: string
  handoff?: AgentChatRequest['handoff']
  previewText?: string
}>()
const emit = defineEmits<{ closed: [] }>()
const state = createAgentChat(),
  open = ref(false),
  selection = ref<ExtensionSelection>({ skillIds: [], toolIds: [] })
async function show() {
  open.value = true
  await state.load()
  if (props.initialSessionId && props.initialSessionId !== state.sessionId.value)
    await state.open(props.initialSessionId)
  if (props.handoff) {
    await state.create()
    state.text.value = '请根据所选消息继续完成任务'
  } else if (!state.text.value) state.text.value = props.text ?? ''
}
const { copyState, copyCode } = useMarkdownCopy(copyText)
const primary = computed(() => ({
  action: 'submit' as const,
  label: '使用所选工具执行',
  enabled:
    !state.pending.value &&
    !state.active.value &&
    !!state.modelId.value &&
    !!state.text.value.trim() &&
    !!selection.value.toolIds.length,
  pending: state.pending.value,
}))
onMounted(() => {
  if (props.standalone) void show()
})
watch(
  () => props.initialSessionId,
  (id) => {
    if (props.standalone && id) void state.open(id)
  },
)
watch(
  () => props.handoff,
  (handoff) => {
    if (handoff) void show()
  },
)
onUnmounted(state.dispose)
</script>
<template>
  <NButton v-if="!hideTrigger" size="small" :disabled="disabled" @click="show">工具助手</NButton>
  <NDrawer v-model:show="open" width="min(680px, 100vw)" @update:show="!$event && emit('closed')"
    ><NDrawerContent title="聊天 · 工具助手" closable>
      <NSpace vertical>
        <NCard v-if="handoff" title="带入内容预览" size="small">
          <pre style="max-height: 240px; overflow: auto; white-space: pre-wrap">{{
            previewText
          }}</pre>
          <p>带入所选文字和附件引用。附件内容不作为已读取材料；执行权限按当前选择重新确认。</p>
        </NCard>
        <p>
          独立的工具会话，可使用明确选择的 MCP 与本地创作工具。最多 48 次工具调用、4
          次媒体生成，运行上限 20 分钟。
        </p>
        <NSpace
          ><NSelect
            :value="state.sessionId.value"
            :disabled="state.pending.value"
            style="width: 320px"
            :options="
              state.sessions.value.map((session) => ({ label: session.title, value: session.id }))
            "
            @update:value="state.open"
          /><NButton :disabled="state.pending.value || !!state.active.value" @click="state.create"
            >新建工具会话</NButton
          ></NSpace
        >
        <NSelect
          v-model:value="state.modelId.value"
          :options="state.models.value"
          :disabled="!!state.active.value || state.pending.value"
          placeholder="选择支持工具调用的文字模型"
        />
        <CapabilityPicker
          :scope="{ workspace: 'chat', kind: 'session', scopeId: 'agent-default' }"
          mode="develop"
          agent
          :disabled="!!state.active.value || state.pending.value"
          @change="selection = $event"
        />
        <NAlert v-if="state.creationUncertain.value" type="warning"
          >会话创建结果未知，未自动重试。<NButton
            :disabled="state.pending.value"
            @click="state.reviewCreation"
            >重新读取会话列表</NButton
          ></NAlert
        >
        <NAlert v-if="state.error.value" type="error">{{ state.error.value }}</NAlert>
        <TaskStatusPanel
          v-for="run in state.snapshot.value?.runs"
          :key="run.id"
          :status="
            agentTaskStatus(run, state.pending.value, state.error.value.startsWith('状态同步'))
          "
          @cancel="state.cancel"
          @reconnect="state.load"
        />
        <NAlert
          v-for="ticket in state.recovery.value"
          :key="ticket.request.submissionId"
          type="warning"
          >提交结果未知，草稿已保留。<NButton
            :disabled="state.pending.value"
            @click="state.recover(ticket.request.submissionId)"
            >恢复这次提交</NButton
          ></NAlert
        >
        <NCard
          v-for="event in state.snapshot.value?.events.filter((event) =>
            [
              'run.started',
              'assistant.message',
              'tool.started',
              'tool.settled',
              'tool.finished',
              'skill.loaded',
            ].includes(event.type),
          )"
          :key="event.seq"
          size="small"
          :title="agentEventLabel(event.type)"
        >
          <MarkdownContent
            :content-id="`${event.sessionId}:${event.runId}:${event.seq}`"
            :source="event.text"
            :copy-state="copyState"
            @copy-code="copyCode"
          />
          <ArtifactLinks :data="event.data" />
        </NCard>
        <NCard
          v-for="approval in state.snapshot.value?.approvals.filter(
            (item) => item.status === 'pending',
          )"
          :key="approval.id"
          title="操作审批"
          size="small"
          ><p>{{ approval.command }}</p>
          <pre style="white-space: pre-wrap">{{
            JSON.stringify(approval.parameters, null, 2)
          }}</pre>
          <NSpace
            ><NButton :disabled="state.pending.value" @click="state.resolve(approval.id, false)"
              >拒绝</NButton
            ><NButton
              type="primary"
              :disabled="state.pending.value"
              @click="state.resolve(approval.id, true)"
              >仅允许这次</NButton
            ></NSpace
          ></NCard
        >
        <ComposerShell
          v-model="state.text.value"
          :primary="primary"
          label="工具助手任务"
          placeholder="描述需要工具完成的任务"
          @action="state.send(selection, handoff)"
        />
      </NSpace> </NDrawerContent
  ></NDrawer>
</template>
