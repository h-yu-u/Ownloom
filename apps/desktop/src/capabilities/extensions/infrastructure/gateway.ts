import { extensionEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { ExtensionsGateway } from '../application/ports'
export function createExtensionsGateway(provider: () => Promise<RuntimeClient>): ExtensionsGateway {
  const api = async () => extensionEndpoints(await provider())
  return {
    catalog: async () => (await api()).catalog(),
    skill: async (...args) => (await api()).skill(...args),
    previewSkill: async (...args) => (await api()).previewSkill(...args),
    importSkill: async (...args) => (await api()).importSkill(...args),
    toggleSkill: async (...args) => (await api()).toggleSkill(...args),
    saveServer: async (...args) => (await api()).saveServer(...args),
    server: async (...args) => (await api()).server(...args),
    inventory: async (...args) => (await api()).inventory(...args),
    mutation: async (...args) => (await api()).mutation(...args),
    test: async (...args) => (await api()).test(...args),
    operation: async (...args) => (await api()).operation(...args),
    cancelOperation: async (...args) => (await api()).cancelOperation(...args),
    binding: async (...args) => (await api()).binding(...args),
    saveBinding: async (...args) => (await api()).saveBinding(...args),
    resolve: async (...args) => (await api()).resolve(...args),
    revoke: async (...args) => (await api()).revoke(...args),
  }
}
