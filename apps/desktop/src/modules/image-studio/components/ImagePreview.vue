<script setup lang="ts">
import { NButton, NEmpty, NImage, NSkeleton, NTag } from 'naive-ui'
import { computed, ref } from 'vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import TaskStatusPanel from '../../../shared/ui/TaskStatusPanel.vue'
import { mediaTaskStatus } from '../../../capabilities/media'
import { isTerminal, type ImageArtifact, type ImageJob } from '../domain/image-state'

const props = defineProps<{
  artifact: ImageArtifact | null
  url?: string
  imageError?: string
  job: ImageJob | null
  submitting: boolean
  cancelling: boolean
  saving: boolean
  syncError: string | null
  sourceUrl?: string
  editingLocked?: boolean
}>()
defineEmits<{
  remove: []
  cancel: []
  save: []
  reuse: []
  edit: []
  retryImage: []
  reconnect: []
}>()
const compare = ref(true)
const active = computed(() => props.submitting || (!!props.job && !isTerminal(props.job)))
const task = computed(() =>
  props.job
    ? mediaTaskStatus(props.job, { cancelling: props.cancelling, syncError: props.syncError })
    : null,
)
</script>

<template>
  <section class="panel image-preview" aria-label="图片预览与任务状态">
    <div class="preview-heading">
      <h2><StudioIcon name="image" :size="20" />{{ active ? '当前任务' : '作品预览' }}</h2>
      <NTag
        v-if="artifact && !active"
        size="small"
        :bordered="false"
        :type="artifact.simulated ? 'warning' : 'success'"
      >
        {{ artifact.simulated ? '模拟输出' : '已自动保存' }}
      </NTag>
    </div>
    <TaskStatusPanel
      v-if="task"
      :status="task"
      @cancel="$emit('cancel')"
      @reconnect="$emit('reconnect')"
    />
    <p v-if="submitting">正在提交任务</p>
    <template v-if="artifact">
      <div v-if="sourceUrl" class="compare-toggle">
        <NButton text @click="compare = !compare">{{ compare ? '只看结果' : '对比原图' }}</NButton>
      </div>
      <div class="generated-image-stage" :class="{ comparing: sourceUrl && compare }">
        <div v-if="sourceUrl && compare" class="comparison-source">
          <span>原图</span
          ><NImage
            :src="sourceUrl"
            alt="编辑前的原图"
            object-fit="contain"
            :img-props="{ style: 'max-width:100%;max-height:430px;object-fit:contain' }"
          />
        </div>
        <div class="comparison-result">
          <span v-if="sourceUrl && compare">编辑结果</span>
          <NImage
            v-if="url"
            :src="url"
            :alt="artifact.simulated ? '开发测试生成的模拟图像' : artifact.prompt"
            object-fit="contain"
            :img-props="{ style: 'max-width:100%;max-height:430px;object-fit:contain' }"
          />
          <div v-else-if="imageError" class="preview-image-error">
            <NEmpty :description="imageError" /><NButton secondary @click="$emit('retryImage')">
              重新读取图片
            </NButton>
          </div>
          <NSkeleton v-else width="100%" height="340px" :sharp="false" />
        </div>
      </div>
      <div class="artifact-details">
        <div class="artifact-model">
          {{ artifact.model_name }}
        </div>
        <p class="artifact-prompt">
          {{ artifact.prompt }}
        </p>
        <div class="artifact-parameters">
          <span>{{ artifact.width }} × {{ artifact.height }}</span
          ><span>{{ artifact.steps }} 步</span><span>Seed {{ artifact.seed }}</span
          ><span>{{
            new Date(artifact.created_at * 1000).toLocaleString('zh-CN', { hour12: false })
          }}</span>
        </div>
      </div>
      <div class="preview-actions">
        <NButton :disabled="active" @click="$emit('remove')">移入回收站</NButton>
        <NButton secondary :disabled="editingLocked || !url" @click="$emit('edit')"
          >继续编辑</NButton
        >
        <NButton secondary :disabled="active" @click="$emit('reuse')">
          <StudioIcon name="plus" :size="16" />复用参数 </NButton
        ><NButton
          type="primary"
          :loading="saving"
          :disabled="!url || saving"
          @click="$emit('save')"
        >
          <StudioIcon name="download" :size="17" />保存图片
        </NButton>
      </div>
    </template>
    <div v-else class="preview-empty">
      <div class="empty-image-icon">
        <StudioIcon name="image" :size="44" />
      </div>
      <h3>
        {{ active ? '生成后可在这里查看新作品' : '把你的想象，变成画面' }}
      </h3>
      <p>用文字描述创意，或上传原图和编辑指令，结果会显示在这里。</p>
      <span>本地创作 · 自动留存 · 参数可复用</span>
    </div>
  </section>
</template>

<style scoped src="./ImagePreview.styles.css"></style>
