import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelSummary } from '@mlx-studio/api-client'

export type { ModelSummary } from '@mlx-studio/api-client'
export const useModelDirectoryState = defineStore('model-directory', () => {
  const items = ref<ModelSummary[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let epoch = 0
  async function refresh(load: () => Promise<ModelSummary[]>): Promise<void> {
    const owner = ++epoch
    loading.value = true
    try {
      const result = await load()
      if (owner === epoch) {
        items.value = result
        error.value = null
      }
    } catch (cause) {
      if (owner === epoch) error.value = cause instanceof Error ? cause.message : '读取模型列表失败'
    } finally {
      if (owner === epoch) loading.value = false
    }
  }
  return { items, loading, error, refresh }
})

export interface ModelDirectory {
  readonly items: readonly ModelSummary[]
  readonly loading: boolean
  readonly error: string | null
  refresh(load: () => Promise<ModelSummary[]>): Promise<void>
}
export function useModelDirectory(): ModelDirectory {
  const owner = useModelDirectoryState()
  return {
    get items() {
      return owner.items
    },
    get loading() {
      return owner.loading
    },
    get error() {
      return owner.error
    },
    refresh: owner.refresh,
  }
}
