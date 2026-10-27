<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NInput } from 'naive-ui'
import { composerShortcut, type ComposerAction, type ComposerActionState } from './composer-policy'
const props = withDefaults(
  defineProps<{
    modelValue: string
    primary: ComposerActionState
    secondary?: readonly ComposerActionState[]
    placeholder?: string
    inputDisabled?: boolean
    shortcut?: 'enter' | 'modifier-enter'
    label?: string
    bordered?: boolean
    showReason?: boolean
  }>(),
  {
    shortcut: 'enter',
    label: '消息内容',
    secondary: () => [],
    placeholder: '',
    bordered: true,
    showReason: true,
  },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  action: [action: ComposerAction]
}>()
const composing = ref(false)
function keydown(event: KeyboardEvent): void {
  const intent = composerShortcut(event, props.shortcut, composing.value)
  if (intent === 'ignore') return
  event.preventDefault()
  if (intent === 'trigger' && props.primary.enabled) emit('action', props.primary.action)
}
</script>
<template>
  <section class="composer-shell">
    <slot name="attachments" /><slot name="context" />
    <slot name="input">
      <NInput
        :value="modelValue"
        type="textarea"
        :bordered="bordered"
        :autosize="{ minRows: 2, maxRows: 8 }"
        :placeholder="placeholder"
        :disabled="inputDisabled"
        :aria-label="label"
        @update:value="emit('update:modelValue', $event)"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown="keydown"
      />
    </slot>
    <div class="shell-actions">
      <div class="shell-tools"><slot name="tools" /></div>
      <slot name="actions">
        <NButton
          v-for="item in secondary"
          :key="item.action"
          :disabled="!item.enabled"
          :loading="item.pending"
          @click="emit('action', item.action)"
          >{{ item.label }}</NButton
        >
        <NButton
          type="primary"
          :disabled="!primary.enabled"
          :loading="primary.pending"
          @click="emit('action', primary.action)"
          >{{ primary.label }}</NButton
        >
      </slot>
    </div>
    <p v-if="showReason && primary.reason" class="shell-hint" role="status">{{ primary.reason }}</p>
    <slot name="hint" />
  </section>
</template>
<style scoped>
.composer-shell {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.shell-actions,
.shell-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.shell-tools {
  flex: 1;
}
.shell-hint {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}
</style>
