<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NFormItem, NInput, NModal, NSelect, NSpace, NSwitch } from 'naive-ui'
import type { components, ModelSummary } from '@mlx-studio/api-client'
type Settings = components['schemas']['DraftSettingsRequest']
const props = defineProps<{
  model: ModelSummary | null
  settings: Settings
  saving: boolean
  error: string | null
}>()
const emit = defineEmits<{
  close: []
  pick: [kind: 'mtp' | 'dflash2']
  save: []
  'update:settings': [settings: Settings]
}>()
function update(patch: Partial<Settings>): void {
  emit('update:settings', { ...props.settings, ...patch })
}
const modes = [
  { label: '自动：聊天 MTP，Coding DFlash2', value: 'auto' },
  { label: '仅 MTP', value: 'mtp' },
  { label: '仅 DFlash2', value: 'dflash2' },
]
const paths = computed(() =>
  [
    {
      kind: 'mtp' as const,
      label: 'MTP 草稿目录',
      value: props.settings.mtpPath,
      field: 'mtpPath' as const,
    },
    {
      kind: 'dflash2' as const,
      label: 'DFlash2 草稿目录',
      value: props.settings.dflashPath,
      field: 'dflashPath' as const,
    },
  ].filter((item) => props.settings.mode === 'auto' || props.settings.mode === item.kind),
)
</script>

<template>
  <NModal
    :show="model !== null"
    preset="card"
    title="草稿加速（实验）"
    class="draft-settings"
    :closable="!saving"
    :mask-closable="!saving"
    :close-on-esc="!saving"
    @update:show="
      (show) => {
        if (!show) $emit('close')
      }
    "
  >
    <NSpace vertical :size="16">
      <NFormItem label="开启草稿加速">
        <NSwitch
          :value="settings.enabled"
          :disabled="saving"
          aria-label="开启草稿加速"
          @update:value="update({ enabled: $event })"
        />
      </NFormItem>
      <NAlert type="info" :show-icon="false">
        此模型有准备中、排队或执行中的 Coding / Agent 任务时，请等待任务结束或先停止任务再保存。
        保存会等待当前推理结束，并卸载已加载的此模型；新设置在下次加载时生效。关闭后保留已选目录。
      </NAlert>
      <template v-if="settings.enabled">
        <NFormItem label="加速方案">
          <NSelect
            :value="settings.mode"
            :options="modes"
            :disabled="saving"
            aria-label="加速方案"
            @update:value="update({ mode: $event })"
          />
        </NFormItem>
        <NAlert type="warning" :show-icon="false">
          需要与主模型配套的本地草稿。自动模式按工作区选择；带图片的请求使用普通生成。
          输出可能与普通模式不同，速度取决于任务。DFlash2 暂不复用聊天前缀缓存。
        </NAlert>
        <NFormItem v-for="item in paths" :key="item.kind" :label="item.label">
          <NSpace vertical class="draft-path">
            <NInput
              :value="item.value ?? ''"
              :disabled="saving"
              :aria-label="item.label"
              placeholder="包含 config.json 和 model.safetensors 的文件夹"
              @update:value="update({ [item.field]: $event || null })"
            />
            <NButton :disabled="saving" @click="$emit('pick', item.kind)">选择文件夹</NButton>
          </NSpace>
        </NFormItem>
        <NFormItem v-if="settings.mode !== 'dflash2'" label="MTP 草稿块长">
          <NSelect
            :value="settings.mtpBlockSize"
            :options="[
              { label: '3（推荐）', value: 3 },
              { label: '4', value: 4 },
            ]"
            :disabled="saving"
            aria-label="MTP 草稿块长"
            @update:value="update({ mtpBlockSize: $event })"
          />
        </NFormItem>
        <NFormItem v-if="settings.mode !== 'mtp'" label="DFlash2 草稿块长">
          <NSelect
            :value="settings.dflashBlockSize"
            :options="[
              { label: '5（Coding 推荐）', value: 5 },
              { label: '4', value: 4 },
            ]"
            :disabled="saving"
            aria-label="DFlash2 草稿块长"
            @update:value="update({ dflashBlockSize: $event })"
          />
        </NFormItem>
      </template>
      <NAlert v-if="error" type="error" role="alert">{{ error }}</NAlert>
      <NSpace justify="end">
        <NButton :disabled="saving" @click="$emit('close')">取消</NButton>
        <NButton type="primary" :loading="saving" @click="$emit('save')">保存</NButton>
      </NSpace>
    </NSpace>
  </NModal>
</template>
<style scoped>
.draft-settings {
  width: min(580px, calc(100vw - 32px));
}
.draft-path {
  width: 100%;
}
</style>
