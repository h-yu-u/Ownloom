<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { NButton, NDrawer, NDrawerContent, NSelect, NInput, NSpace, NAlert } from 'naive-ui'
import type { ExtensionSelection } from '@mlx-studio/api-client'
import { createTextAssistant } from '../configuration'
import { copyText } from '../../../platform/clipboard'
import CapabilityPicker from './CapabilityPicker.vue'
const props = defineProps<{
  workspace: 'image' | 'audio'
  text: string
  disabled?: boolean
  targetKey?: string
}>()
let revision = 0,
  captured: { key?: string; revision: number } | undefined
const conflict = ref(false)
watch(
  () => [props.text, props.targetKey],
  () => {
    revision++
  },
  { flush: 'sync' },
)
const emit = defineEmits<{ apply: [text: string] }>()
const state = createTextAssistant(),
  open = ref(false),
  selection = ref<ExtensionSelection | undefined>()
async function show() {
  captured = { key: props.targetKey, revision }
  conflict.value = false
  open.value = true
  await state.load()
}
function applyDraft(force = false): void {
  if (captured?.key !== props.targetKey) {
    conflict.value = true
    return
  }
  if (!force && captured?.revision !== revision) {
    conflict.value = true
    return
  }
  emit('apply', state.draft.value)
  open.value = false
}
onUnmounted(state.dispose)
</script>
<template>
  <NButton size="small" :disabled="disabled" @click="show">{{
    workspace === 'image' ? '提示词助手' : '口播助手'
  }}</NButton>
  <NDrawer v-model:show="open" width="min(560px, 100vw)"
    ><NDrawerContent :title="workspace === 'image' ? '提示词助手' : '口播助手'" closable>
      <NSpace vertical>
        <p>选择本地文字模型整理草稿，确认后应用到创作表单。</p>
        <NSelect
          v-model:value="state.modelId.value"
          :options="state.models.value"
          :disabled="state.pending.value"
          placeholder="选择文字模型"
          aria-label="助手文字模型"
        />
        <CapabilityPicker
          :scope="{ workspace, kind: 'workspace', scopeId: 'default' }"
          :disabled="state.pending.value"
          @change="selection = $event"
        />
        <NAlert v-if="state.error.value" type="error">{{ state.error.value }}</NAlert>
        <NButton
          :loading="state.pending.value"
          :disabled="!text.trim() || !state.modelId.value"
          @click="state.generate({ workspace, text, selection })"
          >{{ workspace === 'image' ? '优化提示词' : '整理口播文本' }}</NButton
        >
        <NButton v-if="state.pending.value" @click="state.cancel">停止助手</NButton>
        <NInput
          v-model:value="state.draft.value"
          type="textarea"
          :autosize="{ minRows: 12, maxRows: 22 }"
          placeholder="助手结果可在这里编辑"
          aria-label="可编辑草稿"
          :disabled="state.pending.value"
        />
        <NAlert v-if="conflict" type="warning"
          >目标输入已改变，候选结果已保留。<NButton
            :disabled="captured?.key !== targetKey"
            @click="applyDraft(true)"
            >替换当前内容</NButton
          ><NButton @click="copyText(state.draft.value)">复制结果</NButton
          ><NButton @click="conflict = false">取消</NButton></NAlert
        >
        <NButton
          type="primary"
          :disabled="disabled || state.pending.value || !state.draft.value.trim()"
          @click="applyDraft()"
          >应用草稿</NButton
        >
      </NSpace>
    </NDrawerContent></NDrawer
  >
</template>
