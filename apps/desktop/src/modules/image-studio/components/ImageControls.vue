<script setup lang="ts">
import { NAlert, NButton, NInput, NRadioButton, NRadioGroup } from 'naive-ui'
import { computed } from 'vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import { ModelSelect, type ModelOptionView } from '../../../capabilities/models'
import type { ModelSummary } from '../../../capabilities/models'
import type { ImageDraft, ImageMode } from '../domain/image-state'
import ImageReferences from './ImageReferences.vue'
import ImageParameters from './ImageParameters.vue'
const props = defineProps<{
  form: ImageDraft
  models: ModelSummary[]
  locked: boolean
  submitting: boolean
  inputUrls: Record<string, string>
  inputNames: Record<string, string>
  uploading: boolean
  inputError: string | null
  inputErrors?: Record<string, string>
}>()
const emit = defineEmits<{
  'update:form': [value: ImageDraft]
  generate: []
  upload: [files: File[]]
  remove: [index: number]
  move: [index: number, direction: number]
  mask: []
  retryInputs: []
}>()
const mode = computed(() => props.form.mode ?? 'generate')
const editing = computed(() => mode.value !== 'generate')
const selected = computed(() => props.models.find((model) => model.id === props.form.modelId))
const supported = computed(
  () =>
    !editing.value ||
    (mode.value === 'inpaint'
      ? selected.value?.capabilities.inpainting === true
      : selected.value?.capabilities.imageEditing === true),
)
const options = computed(() =>
  props.models.map(
    (model): ModelOptionView => ({
      label: model.source === 'builtin' ? '开发测试模型 · 模拟图片' : model.displayName,
      id: model.id,
      capabilityLabel: model.state === 'loaded' ? '已加载' : '任务按需准备',
      availability:
        editing.value &&
        (mode.value === 'inpaint'
          ? model.capabilities.inpainting !== true
          : model.capabilities.imageEditing !== true)
          ? 'unavailable'
          : 'available',
      disabledReason:
        editing.value &&
        (mode.value === 'inpaint'
          ? model.capabilities.inpainting !== true
          : model.capabilities.imageEditing !== true)
          ? '不支持此编辑模式'
          : undefined,
    }),
  ),
)
const canGenerate = computed(
  () =>
    !!props.form.modelId &&
    !!props.form.prompt.trim() &&
    supported.value &&
    !props.form.referenceIds?.some((id) => props.inputErrors?.[id]) &&
    (!editing.value || !!props.form.referenceIds?.length) &&
    (mode.value !== 'inpaint' || !!props.form.maskId),
)
function update<K extends keyof ImageDraft>(key: K, value: ImageDraft[K]): void {
  emit('update:form', { ...props.form, [key]: value })
}
function changeMode(value: ImageMode): void {
  const compatible = props.models.find(
    (model) =>
      model.source !== 'builtin' &&
      (value === 'inpaint'
        ? model.capabilities.inpainting === true
        : model.capabilities.imageEditing === true),
  )
  emit('update:form', {
    ...props.form,
    mode: value,
    modelId:
      value !== 'generate' &&
      (value === 'inpaint'
        ? selected.value?.capabilities.inpainting !== true
        : selected.value?.capabilities.imageEditing !== true)
        ? (compatible?.id ?? props.form.modelId)
        : props.form.modelId,
    steps: value !== 'generate' && props.form.steps === 20 ? 40 : props.form.steps,
  })
}
</script>
<template>
  <section class="panel image-controls" aria-label="图片创作设置">
    <NRadioGroup
      :value="mode"
      :disabled="locked"
      class="creation-modes"
      aria-label="创作模式"
      @update:value="changeMode"
    >
      <NRadioButton value="generate">文字生图</NRadioButton
      ><NRadioButton value="edit">图片编辑</NRadioButton
      ><NRadioButton value="inpaint">局部重绘</NRadioButton>
    </NRadioGroup>
    <p class="mode-description">
      {{
        mode === 'generate'
          ? '用文字描述创意，从空白开始创作。'
          : mode === 'edit'
            ? '上传原图，用一句话换颜色、背景或参考风格。'
            : '涂抹要修改的区域，让画面其余部分保持原样。'
      }}
    </p>
    <label for="image-model">{{ editing ? '编辑模型' : '生图模型' }}</label>
    <ModelSelect
      :model-value="form.modelId"
      :options="options"
      :disabled="locked"
      label="创作模型"
      @update:model-value="update('modelId', $event)"
    />
    <RouterLink to="/models" class="model-library-link"
      >前往模型库下载或导入 <StudioIcon name="arrow" :size="14"
    /></RouterLink>
    <NAlert v-if="selected?.source === 'builtin'" type="info" :show-icon="false"
      >开发测试模式：只生成模拟图片。</NAlert
    >
    <NAlert v-if="!supported" type="warning" :show-icon="false"
      >当前模型不支持编辑，请导入包含完整视觉组件的编辑模型。</NAlert
    >
    <ImageReferences
      v-if="editing"
      :ids="form.referenceIds ?? []"
      :urls="inputUrls"
      :names="inputNames"
      :errors="inputErrors"
      :locked="locked"
      :uploading="uploading"
      @upload="emit('upload', $event)"
      @remove="emit('remove', $event)"
      @move="(index, direction) => emit('move', index, direction)"
    />
    <NAlert v-if="inputError" type="error" :show-icon="false" role="alert"
      >{{ inputError }} <NButton text @click="emit('retryInputs')">重新读取</NButton></NAlert
    >
    <NButton
      v-if="mode === 'inpaint'"
      secondary
      :disabled="locked || !form.referenceIds?.length || !inputUrls[form.referenceIds[0] ?? '']"
      @click="emit('mask')"
      >{{ form.maskId ? '重新涂抹修改区域' : '涂抹需要修改的区域' }}</NButton
    >
    <span v-if="mode === 'inpaint'" class="mask-hint">{{
      form.maskId ? '修改区域已保存 · 更换原图后需重新涂抹' : '先上传原图，再涂抹要改变的位置。'
    }}</span>
    <label for="image-prompt">{{ editing ? '你想怎样修改？' : '描述你的画面' }}</label>
    <NInput
      :value="form.prompt"
      type="textarea"
      :autosize="{ minRows: 4, maxRows: 7 }"
      :maxlength="10000"
      :disabled="locked"
      :input-props="{ id: 'image-prompt', 'aria-label': editing ? '编辑指令' : '图片提示词' }"
      :placeholder="
        editing
          ? '例如：把图 1 中的茶壶改成蓝色，保持形状和背景不变。有多张图时可写：使用图 2 的配色。'
          : '例如：日落时分的山间湖泊，柔和的粉紫色天空…'
      "
      @update:value="update('prompt', $event)"
    />
    <ImageParameters
      :form="form"
      :locked="locked"
      :editing="editing"
      @update:form="emit('update:form', $event)"
    />
    <NButton
      class="generate-image-button"
      type="primary"
      block
      :loading="submitting || uploading"
      :disabled="locked || !canGenerate"
      @click="emit('generate')"
      ><StudioIcon name="bolt" :size="19" />{{
        uploading ? '正在保存图片' : submitting ? '提交任务' : editing ? '开始编辑' : '生成图片'
      }}</NButton
    >
    <p class="image-save-hint">结果和参考图会自动留存，可从作品历史继续编辑。</p>
  </section>
</template>
<style scoped>
.image-controls {
  padding: 21px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  align-self: start;
}
.creation-modes {
  display: flex;
  width: 100%;
}
.creation-modes :deep(.n-radio-button) {
  flex: 1;
  padding: 0 8px;
  text-align: center;
  font-size: 12px;
}
.mode-description,
.image-save-hint,
.mask-hint {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.7;
}
.image-controls > label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
}
.model-library-link {
  display: flex;
  gap: 7px;
  align-items: center;
  font-size: 12px;
  color: var(--text-primary);
  text-decoration: none;
}
.image-controls .n-alert {
  font-size: 12px;
}
.generate-image-button {
  height: 44px;
  margin-top: 2px;
}
.generate-image-button :deep(.n-button__content) {
  gap: 8px;
}
</style>
