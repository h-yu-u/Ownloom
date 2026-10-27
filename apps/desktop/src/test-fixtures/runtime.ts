import type { ModelSummary } from '@mlx-studio/api-client'
export function modelFixture(fields: Partial<ModelSummary>): ModelSummary {
  return {
    id: 'model',
    displayName: 'Model',
    source: 'local',
    engine: 'fake',
    task: 'text-generation',
    state: 'available',
    localPath: 'fake://text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    contextLength: null,
    capabilities: {},
    installationId: 'model',
    managedInstallation: false,
    artifactIdentity: null,
    ...fields,
  }
}
