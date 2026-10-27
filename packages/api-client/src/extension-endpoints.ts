import type { Transport } from './transport/ports'
import {
  decodeExtensionCatalog,
  decodeServer,
  decodeInventory,
  decodeBinding,
  decodeMutation,
  decodeOperation,
  decodeResolution,
  decodeSkillInspection,
  type ExtensionScope,
  type ExtensionSelection,
  type McpWriteRequest,
  type SkillImportRequest,
} from './extension-decoders'
const root = '/internal/v1/extensions',
  id = encodeURIComponent
export function extensionEndpoints(transport: Pick<Transport, 'get' | 'post' | 'patch' | 'put'>) {
  return {
    catalog: async () => decodeExtensionCatalog(await transport.get(`${root}/catalog`)),
    skill: async (key: string, revision?: number) =>
      decodeSkillInspection(
        await transport.get(`${root}/skills/${id(key)}${revision ? `?revision=${revision}` : ''}`),
      ),
    previewSkill: async (body: SkillImportRequest) =>
      decodeSkillInspection(await transport.post(`${root}/skills/preview`, body)),
    importSkill: async (body: SkillImportRequest) =>
      decodeMutation(await transport.post(`${root}/skills/import`, body)),
    toggleSkill: async (key: string, revision: number, enabled: boolean) =>
      decodeMutation(
        await transport.patch(`${root}/skills/${id(key)}`, {
          mutationId: crypto.randomUUID(),
          expectedRevision: revision,
          enabled,
        }),
      ),
    saveServer: async (body: McpWriteRequest) =>
      decodeMutation(await transport.post(`${root}/mcp`, body)),
    server: async (key: string) => decodeServer(await transport.get(`${root}/mcp/${id(key)}`)),
    inventory: async (key: string, revision: number) =>
      decodeInventory(
        await transport.get(`${root}/mcp/${id(key)}/tools?configRevision=${revision}`),
      ),
    mutation: async (key: string) => {
      const value = await transport.get(`${root}/mutations/${id(key)}`)
      return value === null ? null : decodeMutation(value)
    },
    test: async (key: string, revision: number) =>
      decodeOperation(
        await transport.post(`${root}/mcp/${id(key)}/test`, { configRevision: revision }),
      ),
    operation: async (key: string) =>
      decodeOperation(await transport.get(`${root}/operations/${id(key)}`)),
    cancelOperation: async (key: string) =>
      decodeOperation(await transport.post(`${root}/operations/${id(key)}/cancel`)),
    binding: async (scope: ExtensionScope) =>
      decodeBinding(await transport.get(`${root}/bindings?${new URLSearchParams(scope)}`)),
    saveBinding: async (
      scope: ExtensionScope,
      revision: number,
      selection: ExtensionSelection,
      mutationId: string,
    ) =>
      decodeMutation(
        await transport.put(
          `${root}/bindings/${id(`${scope.workspace}:${scope.kind}:${scope.scopeId}`)}`,
          { mutationId, expectedRevision: revision, scope, selection },
        ),
      ),
    resolve: async (
      scope: ExtensionScope,
      selection?: ExtensionSelection,
      mode?: 'analyze' | 'develop' | 'review',
      channel?: 'text' | 'agent',
    ) =>
      decodeResolution(
        await transport.post(`${root}/resolve`, { scope, selection, mode, channel }),
      ),
    revoke: async (targetId: string) =>
      decodeMutation(
        await transport.post(`${root}/revoke`, { mutationId: crypto.randomUUID(), targetId }),
      ),
  }
}
