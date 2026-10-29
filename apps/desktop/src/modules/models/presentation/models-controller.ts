import { ref, computed } from 'vue'
import type { components } from '@mlx-studio/api-client'
import type { ModelsGateway } from '../application/ports'
import type { useModelDirectory } from '../../../capabilities/models'
import { createDraftController } from './draft-controller'
interface ModelsDependencies {
  gateway: ModelsGateway
  directory: ReturnType<typeof useModelDirectory>
  pickDirectory(): Promise<string | null>
}

export type HubModelOption = components['schemas']['HubModelOption']

export function createModelsController(deps: ModelsDependencies) {
  const items = computed(() => deps.directory.items)
  const loading = computed(() => deps.directory.loading)
  const error = computed(() => deps.directory.error)

  const catalog = ref<HubModelOption[]>([])
  const catalogQuery = ref('')
  const catalogLoading = ref(false)
  const catalogError = ref<string | null>(null)
  const selectedRepoId = ref<string | null>(null)
  const selectedHubModel = ref<HubModelOption | null>(null)
  const pullingRepoId = ref<string | null>(null)
  const downloadError = ref<string | null>(null)
  const lastDownloadedRepoId = ref<string | null>(null)
  const downloadQueuedRepoId = ref<string | null>(null)
  let catalogRequest = 0

  async function searchCatalog(query = ''): Promise<void> {
    const request = ++catalogRequest
    catalogQuery.value = query.trim().slice(0, 100)
    catalogLoading.value = true
    catalogError.value = null
    try {
      const result = await deps.gateway.catalog(catalogQuery.value)
      if (request === catalogRequest) catalog.value = result
    } catch (cause) {
      if (request !== catalogRequest) return
      catalog.value = []
      catalogError.value = cause instanceof Error ? cause.message : '读取 Hugging Face 模型失败'
    } finally {
      if (request === catalogRequest) catalogLoading.value = false
    }
  }

  function selectHubModel(repoId: string | null): void {
    selectedRepoId.value = repoId
    selectedHubModel.value = catalog.value.find((item) => item.repo_id === repoId) ?? null
    downloadError.value = null
  }

  async function refresh(): Promise<void> {
    await deps.directory.refresh(deps.gateway.list)
  }

  async function importFolder(): Promise<boolean> {
    const path = await deps.pickDirectory()
    if (!path) return false
    await deps.gateway.import(path)
    await refresh()
    return true
  }

  async function pullModel(): Promise<boolean> {
    const repoId = selectedRepoId.value
    if (!repoId || !selectedHubModel.value || pullingRepoId.value) return false
    if (items.value.some((item) => item.source === 'huggingface' && item.displayName === repoId))
      return false
    pullingRepoId.value = repoId
    downloadError.value = null
    lastDownloadedRepoId.value = null
    try {
      if (deps.gateway.startDownload) {
        await deps.gateway.startDownload(repoId)
        downloadQueuedRepoId.value = repoId
      } else {
        await deps.gateway.pull(repoId)
        lastDownloadedRepoId.value = repoId
      }
      await refresh()
      return true
    } catch (cause) {
      downloadError.value = cause instanceof Error ? cause.message : '模型下载失败，请重试'
      return false
    } finally {
      pullingRepoId.value = null
    }
  }

  async function deleteFiles(id: string): Promise<void> {
    await deps.gateway.deleteFiles(id)
    await refresh()
  }

  async function load(id: string): Promise<void> {
    await deps.gateway.load(id)
    await refresh()
  }

  async function unregister(id: string): Promise<void> {
    await deps.gateway.unregister(id)
    await refresh()
  }

  return {
    ...createDraftController({ ...deps, refresh }),
    items,
    loading,
    error,
    refresh,
    importFolder,
    pullModel,
    deleteFiles,
    load,
    unregister,
    unload: async (id: string) => {
      await deps.gateway.unload(id)
      await refresh()
    },
    catalog,
    catalogQuery,
    catalogLoading,
    catalogError,
    searchCatalog,
    selectHubModel,
    selectedRepoId,
    selectedHubModel,
    pullingRepoId,
    downloadError,
    downloadQueuedRepoId,
    lastDownloadedRepoId,
  }
}
