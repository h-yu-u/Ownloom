<script setup lang="ts">
import { ref } from 'vue'
import { NAlert, NButton, NCard, NInput, NPopconfirm, NSpace, NTag } from 'naive-ui'
import type { Voice, VoicePatch } from '../application/ports'
const props = defineProps<{
  voice: Voice
  url?: string
  busy: boolean
  saveRequest: (patch: VoicePatch) => Promise<boolean>
  error?: string | null
}>()
const emit = defineEmits<{
  preview: []
  remove: [complete: boolean]
}>()
const editing = ref(false),
  name = ref(''),
  text = ref('')
function edit(): void {
  name.value = props.voice.name
  text.value = props.voice.reference_text
  editing.value = true
}
async function save(): Promise<void> {
  if (await props.saveRequest({ name: name.value, reference_text: text.value }))
    editing.value = false
}
</script>
<template>
  <NCard :title="voice.name" size="small">
    <NSpace vertical>
      <NTag size="small"
        >{{
          voice.source === 'self'
            ? '本人声音'
            : voice.source === 'generated'
              ? '合成声音'
              : '已获授权'
        }}
        · v{{ voice.version }}</NTag
      >
      <template v-if="editing">
        <NAlert v-if="error" type="error">{{ error }}</NAlert>
        <NInput v-model:value="name" :disabled="busy" aria-label="音色名称" :maxlength="80" />
        <NInput
          v-model:value="text"
          :disabled="busy"
          type="textarea"
          aria-label="参考原文"
          :maxlength="2000"
        />
        <NSpace
          ><NButton :disabled="busy || !name.trim() || !text.trim()" @click="save">保存修改</NButton
          ><NButton :disabled="busy" @click="editing = false">取消</NButton></NSpace
        >
      </template>
      <p v-else class="reference-text">{{ voice.reference_text }}</p>
      <audio
        v-if="url"
        :src="url"
        controls
        preload="metadata"
        :aria-label="`${voice.name}参考音频`"
      />
      <NSpace>
        <NButton size="small" :disabled="busy" @click="emit('preview')">试听参考录音</NButton>
        <NButton size="small" :disabled="busy" @click="edit">编辑</NButton>
        <NPopconfirm @positive-click="emit('remove', false)"
          ><template #trigger><NButton size="small" :disabled="busy">删除音色</NButton></template
          >仅删除音色记录，保留参考录音和历史作品。</NPopconfirm
        >
        <NPopconfirm @positive-click="emit('remove', true)"
          ><template #trigger
            ><NButton size="small" :disabled="busy" type="error" quaternary
              >完整删除</NButton
            ></template
          >删除音色及参考录音。历史成品保留；录音仍被使用时会阻止删除。</NPopconfirm
        >
      </NSpace>
    </NSpace>
  </NCard>
</template>
<style scoped>
audio {
  width: 100%;
}
.reference-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 100px;
  overflow-y: auto;
}
</style>
