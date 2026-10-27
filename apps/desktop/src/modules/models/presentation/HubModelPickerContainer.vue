<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { useMessage } from 'naive-ui'
import { onMounted } from 'vue'
import HubModelPicker from '../components/HubModelPicker.vue'
import { useModelsStore } from '../stores/models.store'
const store = useModelsStore()
const message = useMessage()
const search = useDebounceFn((query: string) => {
  void store.searchCatalog(query)
}, 350)
onMounted(() => {
  if (!store.catalog.length && !store.catalogLoading) void store.searchCatalog()
})
async function download(): Promise<void> {
  if (await store.pullModel())
    message.success(
      store.downloadQueuedRepoId
        ? '下载任务已接纳，可在全局任务中查看进度'
        : '下载完成，模型已加入本地模型库',
    )
}
</script>
<template>
  <HubModelPicker
    :view="store"
    @search="search"
    @select="store.selectHubModel"
    @download="download"
    @retry="store.searchCatalog(store.catalogQuery)"
  />
</template>
