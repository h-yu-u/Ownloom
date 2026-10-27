<script setup lang="ts">
import { exportFeedback } from '../../../shared/lib/file-export'
import { TextAssistant } from '../../../capabilities/extensions'
import { NAlert, NButton, useMessage } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../../../shared/ui/PageHeader.vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import ImageControls from '../components/ImageControls.vue'
import ImageHistory from '../components/ImageHistory.vue'
import ImagePreview from '../components/ImagePreview.vue'
import ImageTasks from '../components/ImageTasks.vue'
import ImageMaskEditor from '../components/ImageMaskEditor.vue'
import type { ImageArtifact, ImageJob } from '../domain/image-state'
import { useImageStudioStore } from '../stores/image-studio.store'

const store = useImageStudioStore()
const message = useMessage()
const route = useRoute()
const {
  form,
  artifacts,
  jobs,
  activeJob,
  selectedId,
  selectedArtifact,
  imageModels,
  hasActiveJob,
} = storeToRefs(store)
const historySection = ref<HTMLElement | null>(null)
const controlsSection = ref<HTMLElement | null>(null)
const showMask = ref(false)
const tab = ref<'create' | 'works'>('create')
let alive = true
const maskSource = computed(() => store.inputUrls[form.value.referenceIds?.[0] ?? ''])
const previewSource = computed(
  () => store.inputUrls[selectedArtifact.value?.reference_ids?.[0] ?? ''],
)
const locked = computed(
  () =>
    hasActiveJob.value ||
    store.submitting ||
    store.loading ||
    store.uploading ||
    store.preparingEdit,
)
watch(
  () => route.query.prompt,
  (value) => {
    if (typeof value === 'string' && !hasActiveJob.value)
      form.value = { ...form.value, prompt: value }
  },
  { immediate: true },
)
onMounted(() => {
  void store.loadWorkspace()
  const id = route.query.artifactId
  if (typeof id === 'string') void store.selectArtifact(id)
})
watch(
  () => route.query.artifactId,
  (id) => {
    if (typeof id === 'string' && id !== store.selectedId) void store.selectArtifact(id)
  },
)
onBeforeUnmount(() => {
  alive = false
  store.dispose()
})

async function save(): Promise<void> {
  if (!selectedArtifact.value) return
  try {
    const id = selectedArtifact.value.id
    const feedback = exportFeedback(await store.saveArtifact(id))
    if (feedback && alive && selectedArtifact.value?.id === id)
      message[feedback.type](feedback.message)
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '保存图片失败')
  }
}
function reuse(item: ImageArtifact | ImageJob | null): void {
  if (!item || locked.value) return
  tab.value = 'create'
  void store.reuse(item)
  controlsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function select(id: string): void {
  store.selectArtifact(id)
  controlsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
async function saveMask(blob: Blob | null): Promise<void> {
  await store.setMask(blob)
  if (!store.inputError) showMask.value = false
}
async function editSelected(): Promise<void> {
  await store.editArtifact()
  controlsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <section class="page-content image-studio-page">
    <PageHeader title="图片创作" subtitle="从文字开始，或让已有画面焕发新的灵感">
      <template #actions>
        <NButton secondary @click="tab = 'works'">
          <StudioIcon name="image" :size="18" />作品历史
        </NButton>
      </template>
    </PageHeader>
    <NAlert v-if="store.detailError" type="error"
      >{{ store.detailError
      }}<NButton @click="store.selectedId && store.selectArtifact(store.selectedId)"
        >重试详情</NButton
      ></NAlert
    >
    <NAlert v-if="store.restoreCandidate" type="warning"
      >恢复期间输入已改变，作品参数已保留为候选。<NButton @click="store.applyRestoreCandidate"
        >应用这份作品参数</NButton
      ></NAlert
    >
    <NAlert v-for="(notice, index) in store.restoreAdjustments" :key="index" type="warning">{{
      notice.message
    }}</NAlert>
    <div class="media-tabs" role="tablist" aria-label="图片创作导航">
      <NButton :aria-selected="tab === 'create'" role="tab" @click="tab = 'create'">创作</NButton
      ><NButton :aria-selected="tab === 'works'" role="tab" @click="tab = 'works'">作品</NButton>
    </div>
    <TextAssistant
      v-if="tab === 'create'"
      workspace="image"
      target-key="image:current:prompt"
      :text="form.prompt"
      :disabled="locked"
      @apply="form = { ...form, prompt: $event }"
    />
    <NAlert
      v-if="store.error || store.modelError"
      type="error"
      :show-icon="false"
      class="image-page-notice"
      role="alert"
    >
      {{ store.error || store.modelError
      }}<NButton v-if="store.modelError" text type="primary" @click="store.loadWorkspace">
        重试连接
      </NButton>
    </NAlert>
    <NAlert
      v-if="!imageModels.length && !store.loading && !store.modelError"
      type="info"
      :show-icon="false"
      class="image-page-notice"
    >
      还没有本地生图模型，前往模型库下载或导入后即可选择。
    </NAlert>
    <NAlert
      v-if="store.loading"
      type="info"
      :show-icon="false"
      class="image-page-notice"
      aria-live="polite"
    >
      正在读取模型与作品历史…
    </NAlert>
    <NAlert
      v-if="
        activeJob?.state === 'succeeded' &&
        activeJob.artifact_id &&
        activeJob.artifact_id !== selectedId
      "
      type="info"
      >新作品已生成。<NButton @click="store.selectArtifact(activeJob!.artifact_id!)"
        >查看新作品</NButton
      ></NAlert
    >
    <div
      ref="controlsSection"
      class="image-creation-layout"
      :class="{ 'viewing-works': tab === 'works' }"
    >
      <ImageControls
        v-show="tab === 'create'"
        v-model:form="form"
        :models="imageModels"
        :locked="locked"
        :submitting="store.submitting"
        :input-urls="store.inputUrls"
        :input-names="store.inputNames"
        :input-error="store.inputError"
        :input-errors="store.inputErrors"
        :uploading="store.uploading"
        @generate="store.generate"
        @upload="store.uploadReferences"
        @remove="store.removeReference"
        @move="store.moveReference"
        @mask="showMask = true"
        @retry-inputs="store.restoreInputs()"
      />
      <ImagePreview
        :artifact="selectedArtifact"
        :url="selectedId ? store.urls[selectedId] : undefined"
        :image-error="selectedId ? store.imageErrors[selectedId] : undefined"
        :job="activeJob"
        :submitting="store.submitting"
        :cancelling="store.cancelling"
        :saving="!!store.savingId"
        :sync-error="store.syncError"
        :source-url="previewSource"
        :editing-locked="locked"
        @remove="store.recycle"
        @edit="editSelected"
        @cancel="store.cancel"
        @save="save"
        @reuse="reuse(selectedArtifact)"
        @retry-image="selectedId && store.loadImage(selectedId)"
        @reconnect="store.refreshJob"
      />
    </div>
    <ImageMaskEditor
      v-if="showMask && maskSource"
      :source="maskSource"
      :mask-url="store.inputUrls[form.maskId ?? '']"
      :saving="store.uploading"
      @close="showMask = false"
      @save="saveMask"
    />
    <ImageTasks
      v-if="tab === 'works'"
      :jobs="jobs"
      :locked="locked"
      @reuse="reuse"
      @select="select"
    />
    <div v-show="tab === 'works'" ref="historySection">
      <ImageHistory
        :artifacts="artifacts"
        :urls="store.urls"
        :errors="store.imageErrors"
        :selected-id="selectedId"
        :loading="store.historyLoading"
        :error="store.historyError"
        :has-more="store.hasMore"
        @visible="store.imageVisibility($event, true)"
        @hidden="store.imageVisibility($event, false)"
        @select="select"
        @refresh="store.loadHistory(true)"
        @more="store.loadHistory(false)"
      />
    </div>
  </section>
</template>

<style scoped>
.media-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.image-creation-layout.viewing-works {
  grid-template-columns: minmax(0, 1fr);
}
.image-creation-layout {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;
  scroll-margin-top: 16px;
}
.image-page-notice {
  margin-bottom: 16px;
}
.image-page-notice .n-button {
  margin-left: 12px;
}
@media (max-width: 1120px) {
  .image-creation-layout {
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 15px;
  }
}
@media (max-width: 960px) {
  .image-creation-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .image-creation-layout > :first-child {
    order: 1;
  }
  .image-creation-layout > :last-child {
    order: 2;
  }
}
</style>
