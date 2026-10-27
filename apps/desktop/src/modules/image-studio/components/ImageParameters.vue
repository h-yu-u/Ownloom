<script setup lang="ts">
import { NButton, NCollapse, NCollapseItem, NInputNumber, NSlider } from 'naive-ui'
import type { ImageDraft } from '../domain/image-state'
const props = defineProps<{ form: ImageDraft; locked: boolean; editing: boolean }>()
const emit = defineEmits<{ 'update:form': [value: ImageDraft] }>()
const sizes = [
  { label: '1:1', width: 512, height: 512 },
  { label: '4:3', width: 768, height: 576 },
  { label: '16:9', width: 1024, height: 576 },
  { label: '9:16', width: 576, height: 1024 },
]
function update<K extends keyof ImageDraft>(key: K, value: ImageDraft[K]): void {
  emit('update:form', { ...props.form, [key]: value })
}
</script>
<template>
  <section class="image-parameters">
    <div v-if="editing" class="edit-strength">
      <div class="parameter-label">
        <label id="strength-label">修改强度</label
        ><span>{{ Math.round((form.strength ?? 1) * 100) }}%</span>
      </div>
      <NSlider
        :value="Math.round((form.strength ?? 1) * 100)"
        :min="10"
        :max="100"
        :step="5"
        :disabled="locked"
        aria-labelledby="strength-label"
        @update:value="update('strength', $event / 100)"
      />
      <p>越高越容易产生明显变化，越低越贴近原图。</p>
    </div>
    <div class="parameter-label">
      <span>画面比例</span><span>{{ form.width }} × {{ form.height }}</span>
    </div>
    <div class="image-size-presets">
      <NButton
        v-for="size in sizes"
        :key="size.label"
        size="small"
        :type="form.width === size.width && form.height === size.height ? 'primary' : 'default'"
        secondary
        :disabled="locked"
        :aria-pressed="form.width === size.width && form.height === size.height"
        @click="emit('update:form', { ...form, width: size.width, height: size.height })"
        >{{ size.label }}</NButton
      >
    </div>
    <NCollapse class="advanced-settings">
      <NCollapseItem title="更多设置" name="parameters">
        <div class="dimension-fields">
          <div>
            <label for="image-width">宽度</label
            ><NInputNumber
              :value="form.width"
              :min="64"
              :max="2048"
              :step="32"
              :disabled="locked"
              :input-props="{ id: 'image-width', 'aria-label': '图片宽度' }"
              @update:value="update('width', $event ?? 512)"
            />
          </div>
          <div>
            <label for="image-height">高度</label
            ><NInputNumber
              :value="form.height"
              :min="64"
              :max="2048"
              :step="32"
              :disabled="locked"
              :input-props="{ id: 'image-height', 'aria-label': '图片高度' }"
              @update:value="update('height', $event ?? 512)"
            />
          </div>
        </div>
        <label for="image-steps">生成步数</label>
        <NInputNumber
          :value="form.steps"
          :min="1"
          :max="100"
          :disabled="locked"
          :input-props="{ id: 'image-steps', 'aria-label': '生成步数' }"
          @update:value="update('steps', $event ?? 40)"
        />
        <div class="parameter-label">
          <label for="image-seed">Seed</label
          ><NButton text size="tiny" :disabled="locked" @click="update('seed', null)">随机</NButton>
        </div>
        <NInputNumber
          :value="form.seed"
          :min="0"
          :max="4294967295"
          :show-button="false"
          :disabled="locked"
          :input-props="{ id: 'image-seed', 'aria-label': '图片 Seed' }"
          placeholder="留空则随机"
          @update:value="update('seed', $event)"
        />
      </NCollapseItem>
    </NCollapse>
  </section>
</template>
<style scoped>
.image-parameters {
  display: grid;
  gap: 12px;
}
.parameter-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.parameter-label > :last-child {
  color: var(--text-tertiary);
  font-size: 12px;
}
.image-size-presets {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
}
.image-size-presets .n-button {
  padding: 0;
}
.dimension-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.dimension-fields > div {
  min-width: 0;
  display: grid;
  gap: 7px;
}
.advanced-settings :deep(.n-collapse-item__content-inner) {
  display: grid;
  gap: 10px;
}
.advanced-settings label {
  font-size: 12px;
  color: var(--text-secondary);
}
.edit-strength p {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 6px 0 0;
  line-height: 1.6;
}
.edit-strength .n-slider {
  margin-top: 9px;
}
</style>
