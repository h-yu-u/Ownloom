import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { WebSearchGateway } from './controller'
export function createWebSearchGateway(provider: () => Promise<RuntimeClient>): WebSearchGateway {
  const endpoints = async () => createEndpoints(await provider()).webSearch
  return {
    get: async () => (await endpoints()).get(),
    save: async (value) => (await endpoints()).save(value),
    test: async (id, revision) => (await endpoints()).test(id, revision),
  }
}
