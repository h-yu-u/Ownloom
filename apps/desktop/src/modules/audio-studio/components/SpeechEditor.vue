<script setup lang="ts">
import { computed } from 'vue'
import { ModelSelect, modelOptions } from '../../../capabilities/models'
import {
  NAlert,
  NButton,
  NCard,
  NFormItem,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
} from 'naive-ui'
import type { SpeechDraft, SpeechModel, Voice } from '../application/ports'
const props = defineProps<{
  form: SpeechDraft
  models: SpeechModel[]
  voices: Voice[]
  locked: boolean
  submitting: boolean
  readiness?: { canSubmit: boolean; fields: Record<string, string> }
}>()
const emit = defineEmits<{ 'update:form': [value: SpeechDraft]; generate: []; library: [] }>()
const operation = computed(() =>
  props.models
    .find((model) => model.id === props.form.modelId)
    ?.speech?.operations.find((op) => op.mode === props.form.mode),
)
const model = computed(() => props.models.find((model) => model.id === props.form.modelId))
const languages: Record<string, string> = {
  auto: '自动',
  zh: '中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  de: '德语',
  fr: '法语',
  ru: '俄语',
  pt: '葡萄牙语',
  es: '西班牙语',
  it: '意大利语',
}
function update(patch: Partial<SpeechDraft>): void {
  if (patch.mode || patch.modelId) {
    const next =
      props.models.find((model) => model.id === patch.modelId) ??
      props.models.find((model) => model.speech?.operations.some((op) => op.mode === patch.mode))
    const op = next?.speech?.operations.find(
      (item) => item.mode === (patch.mode ?? props.form.mode),
    )
    patch = {
      ...patch,
      modelId: next?.id ?? null,
      speaker: op?.presetSpeakers[0] ?? null,
      language: op?.languages.includes(props.form.language)
        ? props.form.language
        : (op?.languages[0] ?? 'auto'),
    }
  }
  emit('update:form', { ...props.form, ...patch })
}
</script>
<template>
  <NCard title="让文字成为声音" :bordered="false">
    <NSpace vertical :size="18">
      <NRadioGroup
        :value="form.mode"
        :disabled="locked"
        aria-label="创作模式"
        @update:value="(value) => update({ mode: value })"
      >
        <NRadioButton value="preset">预设音色</NRadioButton>
        <NRadioButton value="clone">克隆音色</NRadioButton>
      </NRadioGroup>
      <NFormItem label="语音模型">
        <ModelSelect
          :model-value="form.modelId"
          :options="modelOptions(models, 'audio')"
          :disabled="locked"
          label="语音模型"
          @update:model-value="(value) => update({ modelId: value })"
        />
      </NFormItem>
      <NAlert v-if="model?.source === 'builtin'" type="warning" :show-icon="false"
        >开发测试模式：输出为测试音，不包含朗读或真实声音克隆。</NAlert
      >
      <NAlert v-else-if="model?.speech?.verification === 'candidate'" type="info" :show-icon="false"
        >此模型已静态识别，真实合成质量和离线运行尚待真机验证。</NAlert
      >
      <NFormItem label="朗读文字">
        <NInput
          :value="form.text"
          :input-props="{ 'aria-label': '朗读文字' }"
          type="textarea"
          :autosize="{ minRows: 7, maxRows: 14 }"
          :maxlength="operation?.maxTextCharacters ?? 2000"
          show-count
          :disabled="locked"
          placeholder="写下你想听到的内容…"
          @update:value="(value) => update({ text: value })"
        />
      </NFormItem>
      <NFormItem label="语言">
        <NSelect
          :value="form.language"
          :options="
            (operation?.languages ?? []).map((value) => ({
              value,
              label: languages[value] ?? value,
            }))
          "
          :disabled="locked"
          @update:value="(value) => update({ language: value })"
        />
      </NFormItem>
      <NFormItem v-if="form.mode === 'preset'" label="预设音色">
        <NSelect
          :value="form.speaker"
          :options="(operation?.presetSpeakers ?? []).map((value) => ({ value, label: value }))"
          :disabled="locked"
          @update:value="(value) => update({ speaker: value })"
        />
      </NFormItem>
      <NFormItem v-else label="参考音色">
        <NSpace vertical style="width: 100%">
          <NSelect
            :value="form.voiceId"
            :options="voices.map((voice) => ({ value: voice.id, label: voice.name }))"
            :disabled="locked"
            placeholder="选择已保存的参考音色"
            @update:value="(value) => update({ voiceId: value })"
          />
          <NButton text @click="emit('library')">导入参考音频 / 管理音色 →</NButton>
        </NSpace>
      </NFormItem>
      <p v-if="readiness?.fields.voiceId" role="status">{{ readiness.fields.voiceId }}</p>
      <p v-else-if="readiness?.fields.form" role="status">{{ readiness.fields.form }}</p>
      <NButton
        type="primary"
        size="large"
        block
        :loading="submitting"
        :disabled="locked || !operation || !form.text.trim() || readiness?.canSubmit === false"
        @click="emit('generate')"
        >生成语音</NButton
      >
    </NSpace>
  </NCard>
</template>
