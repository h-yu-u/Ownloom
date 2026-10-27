import type { ModelSummary, components } from '@mlx-studio/api-client'
export type HubModelOption = components['schemas']['HubModelOption']
export interface ModelsGateway {
  list(): Promise<ModelSummary[]>
  catalog(query: string): Promise<HubModelOption[]>
  import(path: string): Promise<unknown>
  startDownload?(id: string): Promise<unknown>
  pull(id: string): Promise<unknown>
  deleteFiles(id: string): Promise<unknown>
  unload(id: string): Promise<unknown>
  load(id: string): Promise<unknown>
  unregister(id: string): Promise<unknown>
}
