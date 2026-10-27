<script setup lang="ts">
import { NAlert, NButton, NModal, NSlider, NSwitch } from 'naive-ui'
import { ref } from 'vue'
import { useMaskPainter } from '../presentation/use-mask-painter'
const props = defineProps<{ source: string; maskUrl?: string; saving: boolean }>()
const emit = defineEmits<{ close: []; save: [blob: Blob | null] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const painter = useMaskPainter(canvas)
const { brush, erasing, ready, hasPaint } = painter
const error = ref<string | null>(null)
async function loaded(event: Event): Promise<void> {
  if (!(event.target instanceof HTMLImageElement)) return
  try {
    await painter.initialize(event.target, props.maskUrl)
  } catch {
    error.value = '区域图片读取失败，请关闭后重试。'
  }
}
async function save(): Promise<void> {
  emit('save', await painter.exportMask())
}
</script>
<template>
  <NModal
    :show="true"
    preset="card"
    title="涂抹修改区域"
    class="mask-editor-modal"
    :style="{ width: 'min(820px, calc(100vw - 40px))' }"
    :mask-closable="false"
    :close-on-esc="!saving"
    :closable="!saving"
    @close="emit('close')"
    @update:show="!$event && emit('close')"
  >
    <p class="mask-help">
      紫色区域会被重新绘制，其余部分保留原图。拖动鼠标涂抹，也可使用橡皮擦修整边界。
    </p>
    <NAlert v-if="error" type="error">{{ error }}</NAlert>
    <div class="mask-toolbar">
      <NSwitch v-model:value="erasing" :disabled="saving"
        ><template #checked>橡皮擦</template><template #unchecked>画笔</template></NSwitch
      >
      <label id="mask-brush-label">笔刷 {{ brush }} px</label
      ><NSlider
        v-model:value="brush"
        :min="8"
        :max="120"
        :disabled="saving"
        aria-labelledby="mask-brush-label"
      />
      <NButton size="small" :disabled="saving || !ready" @click="painter.undo">撤销</NButton
      ><NButton size="small" :disabled="saving || !ready" @click="painter.clear">清空</NButton>
    </div>
    <div class="mask-viewport">
      <div class="mask-stage">
        <img
          :src="source"
          alt="需要局部修改的原图"
          draggable="false"
          @load="loaded"
          @error="error = '原图读取失败，请重新上传。'"
        />
        <canvas
          ref="canvas"
          aria-label="用画笔标记要修改的区域"
          :class="{ disabled: saving }"
          @pointerdown.prevent="painter.start"
          @pointermove.prevent="painter.paint"
          @pointerup="painter.end"
          @pointercancel="painter.end"
        />
      </div>
    </div>
    <template #footer
      ><div class="mask-footer">
        <span>{{ hasPaint ? '已涂抹修改区域' : '请先涂抹需要修改的位置' }}</span
        ><NButton :disabled="saving" @click="emit('close')">取消</NButton
        ><NButton
          type="primary"
          :loading="saving"
          :disabled="!ready || !hasPaint || saving"
          @click="save"
          >保存修改区域</NButton
        >
      </div></template
    >
  </NModal>
</template>
<style scoped>
.mask-help {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 16px;
  line-height: 1.7;
}
.mask-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
  font-size: 12px;
}
.mask-toolbar .n-slider {
  width: 130px;
}
.mask-viewport {
  max-height: 55vh;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--surface-card);
  text-align: center;
  border-radius: 10px;
}
.mask-stage {
  position: relative;
  display: inline-block;
  max-width: 100%;
  vertical-align: top;
}
.mask-stage img {
  display: block;
  max-width: 100%;
  max-height: 54vh;
  object-fit: contain;
}
.mask-stage canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
}
.mask-stage canvas.disabled {
  pointer-events: none;
}
.mask-footer {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.mask-footer span {
  margin-right: auto;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
