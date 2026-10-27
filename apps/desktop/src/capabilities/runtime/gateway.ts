import { createEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
export function createRuntimeGateway(provider: () => Promise<RuntimeClient>) {
  return {
    info: async () => createEndpoints(await provider()).runtime.info(),
    metrics: async () => createEndpoints(await provider()).runtime.metrics(),
    restart: async () => createEndpoints(await provider()).runtime.restart(),
    diagnostics: async () => (await provider()).downloadDiagnosticBundle(),
  }
}
