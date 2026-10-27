import { installWorkspaces } from '../../../app/composition-root'
import { modelFixture } from '../../../test-fixtures/runtime'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModelsStore } from './models.store'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../../../platform/runtime-bridge', () => ({ runtimeClient: async () => api }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
const model = {
  repo_id: 'mlx-community/Qwen',
  downloads: 100,
  likes: 12,
  task: 'text-generation',
  updated_at: null,
}

async function selectedStore(): Promise<ReturnType<typeof useModelsStore>> {
  api.get.mockResolvedValueOnce([model])
  const store = useModelsStore()
  await store.searchCatalog('Qwen')
  store.selectHubModel(model.repo_id)
  return store
}

describe('Hugging Face model discovery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('encodes searches and ignores stale responses', async () => {
    let finishOld: (value: unknown) => void = () => undefined
    api.get.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve
      }),
    )
    api.get.mockResolvedValueOnce([model])
    const store = useModelsStore()
    const oldSearch = store.searchCatalog('old')
    await flushPromises()
    await store.searchCatalog('Qwen & 4-bit')
    finishOld([{ ...model, repo_id: 'community/old' }])
    await oldSearch
    expect(store.catalog).toEqual([model])
    expect(api.get).toHaveBeenLastCalledWith('/internal/v1/models/catalog?query=Qwen%20%26%204-bit')
    expect(store.catalogLoading).toBe(false)
  })

  it('downloads the selected repository and refreshes the local library', async () => {
    const store = await selectedStore()
    api.post.mockResolvedValue({ modelId: 'local-model' })
    api.get.mockResolvedValue([
      modelFixture({ id: 'local-model', displayName: model.repo_id, source: 'huggingface' }),
    ])
    expect(await store.pullModel()).toBe(true)
    expect(api.post).toHaveBeenCalledWith('/internal/v1/downloads', { repo_id: model.repo_id })
    expect(store.items[0]?.displayName).toBe(model.repo_id)
    expect(store.downloadQueuedRepoId).toBe(model.repo_id)
    expect(store.pullingRepoId).toBeNull()
    expect(await store.pullModel()).toBe(false)
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('preserves selection and exposes a retryable download error', async () => {
    const store = await selectedStore()
    api.post.mockRejectedValue(new Error('download offline'))
    expect(await store.pullModel()).toBe(false)
    expect(store.selectedRepoId).toBe(model.repo_id)
    expect(store.downloadError).toBe('download offline')
    expect(store.pullingRepoId).toBeNull()
    api.post.mockResolvedValue({ modelId: 'local-model' })
    api.get.mockResolvedValue([])
    expect(await store.pullModel()).toBe(true)
    expect(store.downloadError).toBeNull()
  })

  it('prevents duplicate downloads and rejects an arbitrary unselected repository', async () => {
    const store = useModelsStore()
    store.selectHubModel('unknown/repository')
    expect(await store.pullModel()).toBe(false)
    await selectedStore()
    let finish: (value: unknown) => void = () => undefined
    api.post.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    api.get.mockResolvedValue([])
    const first = store.pullModel()
    await flushPromises()
    expect(store.pullingRepoId).toBe(model.repo_id)
    expect(await store.pullModel()).toBe(false)
    finish({ modelId: 'local-model' })
    await first
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('settles loading after catalog errors and allows another search', async () => {
    const store = useModelsStore()
    api.get.mockRejectedValueOnce(new Error('catalog offline'))
    await store.searchCatalog('Qwen')
    expect(store.catalogError).toBe('catalog offline')
    expect(store.catalogLoading).toBe(false)
    api.get.mockResolvedValueOnce([model])
    await store.searchCatalog('Qwen')
    expect(store.catalogError).toBeNull()
    expect(store.catalog).toHaveLength(1)
  })
})

installWorkspaces()
