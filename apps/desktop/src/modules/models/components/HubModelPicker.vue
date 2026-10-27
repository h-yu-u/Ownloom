<script setup lang="ts">
import { NAlert, NButton, NEmpty, NSelect, NTag, type SelectOption } from 'naive-ui'
import { computed, h } from 'vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import type { HubModelOption } from '../application/ports'
import type { ModelSummary } from '../../../capabilities/models'

const props = defineProps<{
  view: {
    selectedHubModel: HubModelOption | null
    items: readonly ModelSummary[]
    catalog: HubModelOption[]
    selectedRepoId: string | null
    catalogLoading: boolean
    pullingRepoId: string | null
    catalogError: string | null
    catalogQuery: string
    downloadError: string | null
    lastDownloadedRepoId: string | null
    downloadQueuedRepoId?: string | null
  }
}>()
const emit = defineEmits<{
  search: [query: string]
  select: [id: string | null]
  download: []
  retry: []
}>()
const selected = computed(() => props.view.selectedHubModel)
const downloaded = computed(
  () =>
    !!selected.value &&
    props.view.items.some(
      (item) => item.source === 'huggingface' && item.displayName === selected.value?.repo_id,
    ),
)
const options = computed(() => {
  const items = [...props.view.catalog]
  if (selected.value && !items.some((item) => item.repo_id === selected.value?.repo_id))
    items.unshift(selected.value)
  return items.map((item) => ({
    label: item.repo_id,
    value: item.repo_id,
    downloads: item.downloads,
  }))
})
function renderLabel(option: SelectOption): ReturnType<typeof h> {
  return h('div', { class: 'hub-option' }, [
    h('span', { class: 'hub-option-name' }, String(option.label)),
    h('small', `${Number(option.downloads ?? 0).toLocaleString()} 次下载`),
  ])
}
</script>

<template>
  <section class="panel hub-discovery" aria-label="从 Hugging Face 下载 MLX 模型">
    <div class="hub-heading">
      <div class="hub-icon">
        <StudioIcon name="cube" :size="27" />
      </div>
      <div>
        <h2>发现你的下一个模型</h2>
        <p>从 Hugging Face 直接获取 MLX 模型，选择后即可下载到本机。</p>
      </div>
      <NTag size="small" round :bordered="false"> Hugging Face · MLX </NTag>
    </div>
    <label class="hub-select-label" for="hub-model-picker"
      >选择模型 <span>热门排序 · 支持搜索仓库名称或关键词</span></label
    >
    <div class="hub-picker-row">
      <NSelect
        :input-props="{ id: 'hub-model-picker', 'aria-label': '搜索 MLX 模型' }"
        :value="view.selectedRepoId"
        :options="options"
        :loading="view.catalogLoading"
        :disabled="!!view.pullingRepoId"
        :render-label="renderLabel"
        filterable
        remote
        clearable
        size="large"
        placeholder="搜索 MLX 模型，例如 Qwen、Llama、Gemma…"
        aria-label="搜索并选择 Hugging Face MLX 模型"
        @search="emit('search', $event)"
        @update:value="emit('select', $event)"
      >
        <template #empty>
          <NEmpty
            :description="
              view.catalogLoading
                ? '正在获取 Hugging Face 模型…'
                : view.catalogError
                  ? '暂时无法获取模型，请重试'
                  : '没有找到模型，换个关键词试试'
            "
            size="small"
          />
        </template>
      </NSelect>
      <NButton
        type="primary"
        size="large"
        :loading="!!view.pullingRepoId"
        :disabled="!selected || downloaded || !!view.pullingRepoId"
        @click="emit('download')"
      >
        <StudioIcon name="download" :size="19" />{{
          view.pullingRepoId ? '正在下载' : downloaded ? '已在本地' : '下载模型'
        }}
      </NButton>
    </div>
    <div v-if="selected" class="hub-selection">
      <StudioIcon name="cube" :size="21" />
      <div class="selected-model-info">
        <strong>{{ selected.repo_id }}</strong
        ><span
          >{{ selected.task ?? 'MLX 模型' }} · {{ selected.downloads.toLocaleString() }} 次下载 ·
          {{ selected.likes.toLocaleString() }} 个赞</span
        >
      </div>
      <NTag size="small" :bordered="false" :type="downloaded ? 'success' : 'info'">
        {{ downloaded ? '已下载' : 'MLX' }}
      </NTag>
    </div>
    <NAlert v-if="view.catalogError" type="error" :show-icon="false" class="hub-notice">
      {{ view.catalogError
      }}<NButton text type="primary" @click="emit('retry')"> 重新获取 </NButton>
    </NAlert>
    <NAlert
      v-if="view.pullingRepoId"
      type="info"
      :show-icon="false"
      class="hub-notice"
      aria-live="polite"
    >
      正在下载
      {{ view.pullingRepoId }}，完成后自动加入本地模型库。你可以切换页面，保持应用运行即可。
    </NAlert>
    <NAlert
      v-else-if="view.downloadError"
      type="error"
      :show-icon="false"
      class="hub-notice"
      role="alert"
    >
      {{ view.downloadError }}<span> 可点击“下载模型”重试。</span>
    </NAlert>
    <NAlert v-else-if="view.downloadQueuedRepoId && !downloaded" type="info"
      >{{ view.downloadQueuedRepoId }} 下载任务已接纳，可在全局任务中查看、暂停或继续。</NAlert
    >
    <NAlert
      v-else-if="view.lastDownloadedRepoId"
      type="success"
      :show-icon="false"
      class="hub-notice"
      aria-live="polite"
    >
      {{ view.lastDownloadedRepoId }} 已下载完成。
    </NAlert>
    <p class="hub-footnote">
      <StudioIcon name="info" :size="14" />仅列出公开、无需申请访问的 MLX
      仓库；下载不代表模型已通过本机运行验证。
    </p>
  </section>
</template>

<style>
.hub-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-width: 0;
}
.hub-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hub-option small {
  color: var(--text-secondary);
  font-size: 11px;
  flex-shrink: 0;
}
</style>
<style scoped src="./HubModelPicker.styles.css"></style>
