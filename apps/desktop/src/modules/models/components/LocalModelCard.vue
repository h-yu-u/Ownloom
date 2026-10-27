<script setup lang="ts">
import { NButton, NCard, NTag } from 'naive-ui'
import type { ModelSummary } from '../../../capabilities/models'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
defineProps<{ model: ModelSummary; activeAction: string | null }>()
defineEmits<{
  load: [id: string]
  unload: [id: string]
  unregister: [id: string]
  deleteFiles: [id: string, name: string]
}>()
</script>
<template>
  <NCard size="small" class="local-model-card">
    <div class="local-model-title">
      <div class="local-model-icon">
        <StudioIcon name="cube" :size="23" />
      </div>
      <NTag size="small" :bordered="false" :type="model.state === 'loaded' ? 'success' : 'default'">
        {{
          model.source === 'builtin' ? '开发测试' : model.state === 'loaded' ? '已加载' : '本地模型'
        }}
      </NTag>
    </div>
    <h3>{{ model.displayName }}</h3>
    <div class="local-model-meta">
      <span>{{ model.engine }}</span
      ><span>{{ model.task }}</span>
    </div>
    <p class="local-model-source">
      {{
        model.source === 'huggingface'
          ? 'Hugging Face'
          : model.source === 'builtin'
            ? '内置引擎'
            : '本地导入'
      }}
    </p>
    <p v-if="model.speech" class="local-model-source">
      {{
        model.speech.unavailableReason ??
        (model.speech.verification === 'candidate'
          ? '语音能力已静态识别 · 真机待验证'
          : '语音开发测试引擎')
      }}
    </p>
    <p v-else-if="model.engine === 'unknown'" class="local-model-source">尚未适配此模型架构</p>
    <template #footer>
      <div class="local-model-actions">
        <NButton
          v-if="model.state === 'loaded'"
          size="small"
          :disabled="!!activeAction"
          :loading="activeAction === `unload:${model.id}`"
          @click="$emit('unload', model.id)"
          >卸载模型</NButton
        >
        <NButton
          v-else
          size="small"
          type="primary"
          :loading="activeAction === `load:${model.id}`"
          :disabled="
            !!activeAction || !!model.speech?.unavailableReason || model.engine === 'unknown'
          "
          @click="$emit('load', model.id)"
        >
          加载模型
        </NButton>
        <NButton
          v-if="model.source !== 'builtin'"
          size="small"
          :disabled="!!activeAction"
          @click="$emit('unregister', model.id)"
        >
          移除注册
        </NButton>
        <NButton
          v-if="model.managedInstallation"
          size="small"
          type="error"
          quaternary
          :disabled="!!activeAction"
          @click="$emit('deleteFiles', model.id, model.displayName)"
        >
          删除文件
        </NButton>
      </div>
    </template>
  </NCard>
</template>
<style scoped>
.local-model-card {
  background: linear-gradient(135deg, var(--surface-hover), var(--surface-card));
  border-radius: 12px;
}
.local-model-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.local-model-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  color: var(--text-primary);
  background: var(--border-strong);
}
.local-model-card h3 {
  font-size: 15px;
  font-weight: 550;
  margin: 17px 0 10px;
  overflow-wrap: anywhere;
}
.local-model-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.local-model-meta span {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--surface-hover);
}
.local-model-source {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 13px 0 0;
}
.local-model-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
