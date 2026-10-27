import type { Ref } from 'vue'
import type { ModelSummary } from '@mlx-studio/api-client'
import type { CodingGateway, CodingEvent } from '../application/ports'
export interface CodingControllerDependencies {
  runtimeAvailable?(): boolean
  gateway: CodingGateway
  models: Readonly<Ref<readonly ModelSummary[]>>
  refreshModels(): Promise<void>
  pickDirectory(): Promise<string | null>
  observe(
    after: number,
    refresh: () => Promise<number>,
    fail: (error: unknown) => void,
    apply?: (event: CodingEvent) => boolean,
  ): () => void
}
