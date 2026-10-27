import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { CodingSettingsGateway } from './controller'
export function createCodingSettingsGateway(
  client: () => Promise<RuntimeClient>,
): CodingSettingsGateway {
  return {
    load: async () => createEndpoints(await client()).coding.settings(),
    save: async (value) => createEndpoints(await client()).coding.saveSettings(value),
    models: async () => createEndpoints(await client()).models.list(),
  }
}
