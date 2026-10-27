import { defineStore } from 'pinia'
import type { createWebSearchController } from './controller'
let create: (() => ReturnType<typeof createWebSearchController>) | undefined
export function configureWebSearch(factory: NonNullable<typeof create>): void {
  create = factory
}
export const useWebSearch = defineStore('web-search', () => {
  if (!create) throw new Error('Web search is not configured')
  return create()
})
