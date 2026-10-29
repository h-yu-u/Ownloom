<script setup lang="ts">
import { NButton, NEmpty, NSpin, useDialog, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import StudioIcon from '../../../shared/components/StudioIcon.vue'
import PageHeader from '../../../shared/ui/PageHeader.vue'
import LocalModelCard from '../components/LocalModelCard.vue'
import DraftSettingsModal from '../components/DraftSettingsModal.vue'
import HubModelPicker from '../presentation/HubModelPickerContainer.vue'
import { useModelsStore } from '../stores/models.store'

const store = useModelsStore()
const message = useMessage()
const dialog = useDialog()
const activeAction = ref<string | null>(null)
const discover = ref(false)
onMounted(() => {
  void store.refresh()
})

async function importModel(): Promise<void> {
  activeAction.value = 'import'
  try {
    if (await store.importFolder()) message.success('模型已加入模型库')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导入失败')
  } finally {
    activeAction.value = null
  }
}

async function actOnModel(action: 'load' | 'unload' | 'unregister', id: string): Promise<void> {
  activeAction.value = `${action}:${id}`
  try {
    await store[action](id)
    message.success(
      action === 'load' ? '模型已加载' : action === 'unload' ? '模型已卸载' : '已移除模型注册',
    )
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    activeAction.value = null
  }
}

async function saveDraft(): Promise<void> {
  if (await store.saveDraft()) message.success('设置已保存，下次加载模型时生效')
}

function deleteFiles(modelId: string, name: string): void {
  dialog.warning({
    title: '删除本地模型文件',
    content: `确定删除“${name}”的模型文件吗？此操作不可撤销。`,
    positiveText: '删除文件',
    negativeText: '取消',
    onPositiveClick: async () => {
      activeAction.value = `delete:${modelId}`
      try {
        await store.deleteFiles(modelId)
        message.success('模型文件已删除')
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败')
        return false
      } finally {
        activeAction.value = null
      }
    },
  })
}
</script>

<template>
  <section class="page-content models-page">
    <PageHeader title="模型库" subtitle="发现、下载和管理你的本地 AI 模型">
      <template #actions>
        <NButton
          secondary
          :loading="activeAction === 'import'"
          :disabled="!!activeAction"
          @click="importModel"
        >
          <StudioIcon name="plus" :size="18" />导入本地模型
        </NButton>
      </template>
    </PageHeader>
    <div class="local-models-heading">
      <h2>
        本地模型 <span>{{ store.items.length }}</span>
      </h2>
      <NButton quaternary size="small" :loading="store.loading" @click="store.refresh">
        刷新列表
      </NButton>
    </div>
    <div v-if="store.error" role="alert" class="model-library-error">
      {{ store.error }}<NButton text type="primary" @click="store.refresh"> 重试 </NButton>
    </div>
    <NSpin :show="store.loading">
      <div v-if="store.items.length" class="grid-cards local-model-grid">
        <LocalModelCard
          v-for="model in store.items"
          :key="model.id"
          :model="model"
          :active-action="activeAction"
          @load="actOnModel('load', $event)"
          @unload="actOnModel('unload', $event)"
          @unregister="actOnModel('unregister', $event)"
          @delete-files="deleteFiles"
          @draft="store.showDraft(model)"
        />
      </div>
      <div v-else-if="!store.loading && !store.error" class="panel empty-state">
        <NEmpty description="还没有本地模型">
          <template #extra>
            <span class="empty-model-hint">点击“发现模型”选择 MLX 模型，开始第一次下载</span>
          </template>
        </NEmpty>
      </div>
    </NSpin>
    <NButton class="discover-toggle" :aria-expanded="discover" @click="discover = !discover">{{
      discover ? '收起模型发现' : '发现模型'
    }}</NButton>
    <HubModelPicker v-if="discover" />
    <DraftSettingsModal
      v-model:settings="store.draftSettings"
      :model="store.draftModel"
      :saving="store.draftSaving"
      :error="store.draftError"
      @close="store.closeDraft"
      @pick="store.pickDraftDirectory"
      @save="saveDraft"
    />
  </section>
</template>

<style scoped>
.discover-toggle {
  margin-top: 24px;
}
.local-models-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.local-models-heading h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.local-models-heading h2 span {
  display: grid;
  place-items: center;
  min-width: 24px;
  height: 22px;
  padding: 0 6px;
  background: var(--surface-hover);
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 11px;
}
.local-model-grid {
  margin-top: 17px;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
}
.model-library-error {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--status-error);
  font-size: 13px;
  padding: 12px 0;
}
.empty-model-hint {
  color: var(--text-secondary);
  font-size: 12px;
}
@media (max-width: 680px) {
  .local-model-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
