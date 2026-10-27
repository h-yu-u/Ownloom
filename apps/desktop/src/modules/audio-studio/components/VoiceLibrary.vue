<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NEmpty,
  NFormItem,
  NInput,
  NPopconfirm,
  NSelect,
  NSpace,
  NUpload,
  type UploadFileInfo,
} from 'naive-ui'
import type { AudioAsset, Voice, VoiceInput, VoicePatch } from '../application/ports'
import VoiceCard from './VoiceCard.vue'
const props = defineProps<{
  form: VoiceInput
  consent: boolean
  reference: AudioAsset | null
  voices: Voice[]
  looseReferences: AudioAsset[]
  urls: Record<string, string>
  busy: boolean
  saveLabel?: string
  updateRequest: (id: string, patch: VoicePatch) => Promise<boolean>
  error: string | null
  cleanupError: string | null
}>()
const emit = defineEmits<{
  'update:form': [value: VoiceInput]
  'update:consent': [value: boolean]
  upload: [file: File]
  save: []
  preview: [id: string]
  remove: [id: string, complete: boolean]
  cleanup: []
  removeReference: [id: string]
}>()
function update(patch: Partial<VoiceInput>): void {
  emit('update:form', { ...props.form, ...patch })
}
function fileChanged({ file }: { file: UploadFileInfo }): void {
  if (file.file) emit('upload', file.file)
}
</script>
<template>
  <div class="voice-layout">
    <NCard title="保存参考音色" :bordered="false">
      <NSpace vertical :size="14">
        <NAlert type="info" :show-icon="false"
          >仅使用本人或已获授权的声音。建议单人、低噪声的 5–20 秒录音；支持 16 位 PCM
          WAV，单/双声道，最多 30 秒、12 MiB。</NAlert
        >
        <NAlert v-if="error" type="error">{{ error }}</NAlert>
        <NAlert v-if="cleanupError" type="warning"
          >{{ cleanupError }} <NButton text @click="emit('cleanup')">重试清理</NButton></NAlert
        >
        <NUpload
          accept=".wav,audio/wav"
          :default-upload="false"
          :show-file-list="false"
          :disabled="busy"
          @change="fileChanged"
          ><NButton :loading="busy">导入参考音频</NButton></NUpload
        >
        <template v-if="reference">
          <span
            >{{ reference.original_name }} · {{ reference.duration_seconds.toFixed(1) }} 秒</span
          >
          <audio
            v-if="urls[reference.id]"
            :src="urls[reference.id]"
            controls
            aria-label="新参考音频试听"
          />
        </template>
        <NFormItem label="音色名称"
          ><NInput
            :value="form.name"
            :input-props="{ 'aria-label': '音色名称' }"
            :maxlength="80"
            :disabled="busy"
            @update:value="(name) => update({ name })"
        /></NFormItem>
        <NFormItem label="准确参考原文"
          ><NInput
            :value="form.reference_text"
            :input-props="{ 'aria-label': '准确参考原文' }"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :maxlength="2000"
            :disabled="busy"
            placeholder="逐字填写参考录音中说出的内容"
            @update:value="(reference_text) => update({ reference_text })"
        /></NFormItem>
        <NFormItem label="录音语言"
          ><NSelect
            :value="form.language"
            :options="[
              { label: '中文', value: 'zh' },
              { label: '英语', value: 'en' },
              { label: '其他 / 自动', value: 'auto' },
            ]"
            :disabled="busy"
            @update:value="(language) => update({ language })"
        /></NFormItem>
        <NFormItem label="素材来源"
          ><NSelect
            :value="form.source"
            :options="[
              { label: '本人录音', value: 'self' },
              { label: '已获授权录音', value: 'authorized' },
              { label: '合成声音（已确认可使用）', value: 'generated' },
            ]"
            :disabled="busy"
            @update:value="(source) => update({ source })"
        /></NFormItem>
        <NCheckbox
          :checked="consent"
          :disabled="busy"
          @update:checked="emit('update:consent', $event)"
          >我确认有权使用此声音进行合成</NCheckbox
        >
        <NButton
          type="primary"
          :loading="busy"
          :disabled="!reference || !consent || !form.name.trim() || !form.reference_text.trim()"
          @click="emit('save')"
          >{{ saveLabel ?? '保存音色' }}</NButton
        >
      </NSpace>
    </NCard>
    <NSpace vertical :size="14">
      <NEmpty v-if="!voices.length" description="还没有保存的音色" />
      <VoiceCard
        v-for="voice in voices"
        :key="voice.id"
        :voice="voice"
        :url="urls[voice.reference_asset_id]"
        :busy="busy"
        :save-request="(patch) => updateRequest(voice.id, patch)"
        :error="error"
        @preview="emit('preview', voice.reference_asset_id)"
        @remove="emit('remove', voice.id, $event)"
      />
      <NCard v-if="looseReferences.length" title="保留的参考录音" size="small">
        <NSpace vertical>
          <p>这些录音尚未关联音色。可试听或完整删除；未完成任务引用的录音会保留。</p>
          <div v-for="asset in looseReferences" :key="asset.id">
            <span>{{ asset.original_name }} · {{ asset.duration_seconds.toFixed(1) }} 秒</span>
            <audio
              v-if="urls[asset.id]"
              :src="urls[asset.id]"
              controls
              :aria-label="asset.original_name"
            />
            <NSpace>
              <NButton size="small" :disabled="busy" @click="emit('preview', asset.id)"
                >试听</NButton
              >
              <NPopconfirm @positive-click="emit('removeReference', asset.id)"
                ><template #trigger
                  ><NButton size="small" type="error" :disabled="busy">删除录音</NButton></template
                >完整删除此参考录音？历史成品不会删除。</NPopconfirm
              >
            </NSpace>
          </div>
        </NSpace>
      </NCard>
    </NSpace>
  </div>
</template>
<style scoped>
.voice-layout {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr);
  gap: 20px;
}
audio {
  width: 100%;
}
@media (max-width: 960px) {
  .voice-layout {
    grid-template-columns: 1fr;
  }
}
</style>
