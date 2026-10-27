<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NButton, NPopover, NSelect, NSpace, NAlert, NInput } from 'naive-ui'
import type { ExtensionScope, ExtensionSelection } from '@mlx-studio/api-client'
import { MediaAssetField } from '../../media'
import { useModelDirectory } from '../../models'
import { createCapabilitySelection } from '../configuration'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
const props = defineProps<{
  scope: ExtensionScope
  mode?: 'analyze' | 'develop' | 'review'
  disabled?: boolean
  agent?: boolean
  compact?: boolean
  permissionMode?: 'ask' | 'full'
}>()
const emit = defineEmits<{ change: [selection: ExtensionSelection] }>()
const directory = useModelDirectory()
const imageModels = computed(() =>
  directory.items
    .filter((model) => model.outputModalities.includes('image'))
    .map((model) => ({ label: model.displayName, value: model.id })),
)
const speechModels = computed(() =>
  directory.items
    .filter((model) => model.outputModalities.includes('audio'))
    .map((model) => ({ label: model.displayName, value: model.id })),
)
const media = computed(() => state.selection.value.mediaBindings ?? {})

function setSpeechMode(value: 'preset' | 'clone'): void {
  media.value.speechMode = value
  if (value === 'preset') media.value.voiceId = undefined
  else media.value.speaker = undefined
}
const state = createCapabilitySelection(),
  open = ref(false)
const selectionRevision = ref(0)
watch(
  state.selection,
  () => {
    selectionRevision.value++
  },
  { deep: true, flush: 'sync' },
)
watch(
  () => media.value.imageReferenceIds?.[0],
  (current, previous) => {
    if (previous && current !== previous) media.value.imageMaskId = undefined
  },
  { flush: 'sync' },
)
let generation = 0
watch(
  () => props.scope,
  (scope) => {
    const owner = ++generation
    void state.load(scope).then(() => {
      if (owner === generation && state.catalog.value && !state.error.value)
        emit('change', {
          skillIds: [...state.selection.value.skillIds],
          toolIds: [...state.selection.value.toolIds],
          ...(state.selection.value.mediaBindings
            ? { mediaBindings: { ...state.selection.value.mediaBindings } }
            : {}),
        })
    })
  },
  { immediate: true, deep: true },
)
async function apply(): Promise<void> {
  if (await state.resolve(props.mode, props.agent)) {
    emit('change', {
      skillIds: [...state.selection.value.skillIds],
      toolIds: [...state.selection.value.toolIds],
      ...(state.selection.value.mediaBindings
        ? { mediaBindings: { ...state.selection.value.mediaBindings } }
        : {}),
    })
    open.value = false
  }
}
onUnmounted(state.dispose)
</script>
<template>
  <NPopover v-model:show="open" trigger="click" placement="top-start">
    <template #trigger
      ><NButton
        size="small"
        :disabled="disabled"
        :circle="compact"
        :quaternary="compact"
        :aria-label="compact ? '选择技能与工具' : undefined"
        :title="compact ? '技能与工具' : undefined"
        ><StudioIcon v-if="compact" name="plus" :size="18" /><template v-else
          >{{ scope.workspace === 'coding' || agent ? '技能与工具' : '技能' }}（{{
            state.selection.value.skillIds.length + state.selection.value.toolIds.length
          }}）</template
        ></NButton
      ></template
    >
    <NSpace vertical style="width: 340px">
      <NAlert v-if="state.error.value" type="error">{{ state.error.value }}</NAlert>
      <label
        >技能<NSelect
          v-model:value="state.selection.value.skillIds"
          multiple
          :loading="state.pending.value"
          :options="
            state.skills.value.map((skill) => ({
              label: skill.name + (skill.enabled ? '' : '（已停用）'),
              value: skill.id,
              disabled: !skill.enabled,
            }))
          "
          placeholder="选择本次技能"
      /></label>
      <template v-if="scope.workspace === 'coding' || agent">
        <small
          >已配置 {{ state.serverStates.value.length }} 个 MCP 服务；当前模式：{{
            mode ?? 'develop'
          }}。连接在任务启动时建立；{{
            permissionMode === 'full' ? '本次任务使用完全访问。' : '有副作用调用需要批准。'
          }}</small
        >
        <small v-for="server in state.serverStates.value" :key="server.id"
          >{{ server.name }} · {{ server.enabled ? '启用' : '停用' }} ·
          {{ server.tested ? '目录已校验' : '待连接测试' }} · 已选 {{ server.selected }} 项</small
        >
        <label
          >工具<NSelect
            v-model:value="state.selection.value.toolIds"
            multiple
            :options="[
              ...state.tools.value.map((tool) => ({
                label: tool.label,
                value: tool.id,
                disabled: tool.disabled || (mode !== 'develop' && tool.risk !== 'read'),
              })),
              ...(state.catalog.value?.builtinTools ?? []).map((tool) => ({
                label: tool.originalName === 'image_generate' ? '本地图片生成' : '本地语音合成',
                value: tool.id,
                disabled: mode !== 'develop',
              })),
            ]"
            placeholder="选择本次可申请使用的工具"
        /></label>
        <label v-if="state.selection.value.toolIds.includes('builtin:image_generate')"
          >图片模型<NSelect
            v-model:value="media.imageModelId"
            :options="imageModels"
            placeholder="选择已安装图片模型"
        /></label>
        <template v-if="state.selection.value.toolIds.includes('builtin:image_generate')">
          <label
            >图片模式<NSelect
              v-model:value="media.imageMode"
              :options="[
                { label: '文字生成', value: 'generate' },
                { label: '编辑参考图', value: 'edit' },
                { label: '局部重绘', value: 'inpaint' },
              ]"
          /></label>
          <MediaAssetField
            v-if="media.imageMode === 'edit' || media.imageMode === 'inpaint'"
            kind="image"
            :ids="media.imageReferenceIds ?? []"
            :target-key="`${scope.workspace}:${scope.kind}:${scope.scopeId}:references:${selectionRevision}`"
            :disabled="disabled"
            @change="media.imageReferenceIds = $event"
          />
          <MediaAssetField
            v-if="media.imageMode === 'inpaint'"
            kind="mask"
            :ids="media.imageMaskId ? [media.imageMaskId] : []"
            :target-key="`${scope.workspace}:${scope.kind}:${scope.scopeId}:mask:${media.imageReferenceIds?.[0] ?? ''}`"
            :disabled="disabled || !media.imageReferenceIds?.length"
            @change="media.imageMaskId = $event[0]"
          />
        </template>
        <template v-if="state.selection.value.toolIds.includes('builtin:speech_generate')">
          <label
            >语音模型<NSelect v-model:value="media.speechModelId" :options="speechModels"
          /></label>
          <label
            >语音模式<NSelect
              :value="media.speechMode"
              :options="[
                { label: '预设音色', value: 'preset' },
                { label: '已保存参考音色', value: 'clone' },
              ]"
              @update:value="setSpeechMode"
          /></label>
          <label v-if="media.speechMode === 'preset'"
            >Speaker<NInput v-model:value="media.speaker" placeholder="模型支持的 speaker 名称"
          /></label>
          <MediaAssetField
            v-else-if="media.speechMode === 'clone'"
            kind="voice"
            :ids="media.voiceId ? [media.voiceId] : []"
            :target-key="`${scope.workspace}:${scope.kind}:${scope.scopeId}:voice:${selectionRevision}`"
            :disabled="disabled"
            @change="media.voiceId = $event[0]"
          />
        </template>
      </template>
      <small>仅支持技能指令与参考资源；脚本执行未接入。配置更新下次任务生效。</small>
      <small v-if="state.preview.value"
        >工具 {{ state.preview.value.totalToolCount }} / 16 · 预计上下文
        {{ state.preview.value.estimatedContextTokens }} tokens</small
      >
      <NSpace
        ><NButton
          size="small"
          :disabled="state.pending.value || !state.loaded.value"
          @click="state.saveDefault"
          >{{ state.defaultLabel.value }}</NButton
        ><NButton size="small" type="primary" @click="apply">应用本次选择</NButton></NSpace
      >
      <RouterLink to="/settings/extensions/skills">管理扩展能力</RouterLink>
    </NSpace>
  </NPopover>
</template>
