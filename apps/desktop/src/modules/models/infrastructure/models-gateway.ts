import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
export function createModelsGateway(provider: () => Promise<RuntimeClient>) {
  const endpoints = async () => createEndpoints(await provider())
  return {
    list: async () => (await endpoints()).models.list(),
    catalog: async (query: string) => (await endpoints()).models.catalog(query),
    import: async (path: string) => (await endpoints()).models.import(path),
    startDownload: async (repoId: string) =>
      (await provider()).post('/internal/v1/downloads', { repo_id: repoId }),
    pull: async (repoId: string) => (await endpoints()).models.pull(repoId),
    deleteFiles: async (id: string) => (await endpoints()).models.deleteFiles(id),
    unload: async (id: string) => (await endpoints()).models.unload(id),
    load: async (id: string) => (await endpoints()).models.load(id),
    unregister: async (id: string) => (await endpoints()).models.unregister(id),
  }
}
export type ModelsGateway = ReturnType<typeof createModelsGateway>
