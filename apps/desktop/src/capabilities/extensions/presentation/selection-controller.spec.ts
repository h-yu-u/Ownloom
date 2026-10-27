import { describe, it, expect, vi } from 'vitest'
import { createSelectionController } from './selection-controller'
import { createExtensionsController } from './controller'
import type { ExtensionsGateway } from '../application/ports'
import type { ExtensionCatalog, ExtensionScope, SkillInspection } from '@mlx-studio/api-client'
const catalog: ExtensionCatalog = {
  catalogRevision: 1,
  policyEpoch: 0,
  skills: [],
  servers: [],
  inventories: [],
  builtinTools: [],
}
const scope: ExtensionScope = { workspace: 'coding', kind: 'project', scopeId: 'first' }
function deferred<T>() {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((accept) => {
      resolve = accept
    }),
    resolve,
  }
}
function gateway(overrides: Partial<ExtensionsGateway> = {}): ExtensionsGateway {
  return {
    catalog: vi.fn(async () => catalog),
    binding: vi.fn(async (value) => ({
      id: `${value.workspace}:${value.kind}:${value.scopeId}`,
      revision: 0,
      scope: value,
      selection: { skillIds: [], toolIds: [] },
    })),
    skill: vi.fn(),
    previewSkill: vi.fn(),
    importSkill: vi.fn(),
    toggleSkill: vi.fn(),
    saveServer: vi.fn(),
    server: vi.fn(),
    inventory: vi.fn(),
    mutation: vi.fn(),
    test: vi.fn(),
    operation: vi.fn(),
    cancelOperation: vi.fn(),
    saveBinding: vi.fn(),
    resolve: vi.fn(),
    revoke: vi.fn(),
    ...overrides,
  }
}
describe('extension view ownership', () => {
  it('ignores a late workspace fallback after switching projects', async () => {
    const stale = deferred<Awaited<ReturnType<ExtensionsGateway['binding']>>>(),
      entered = deferred<void>()
    let defaults = 0
    const api = gateway({
      binding: vi.fn(async (value) => {
        const result = {
          id: value.scopeId,
          revision: 0,
          scope: value,
          selection: { skillIds: [], toolIds: [] },
        }
        if (value.kind !== 'workspace') return result
        if (++defaults === 1) {
          entered.resolve()
          return stale.promise
        }
        return { ...result, selection: { skillIds: ['new-scope'], toolIds: [] } }
      }),
    })
    const controller = createSelectionController(api)
    const first = controller.load(scope)
    await entered.promise
    await controller.load({ ...scope, scopeId: 'second' })
    stale.resolve({
      id: 'default',
      revision: 1,
      scope: { ...scope, kind: 'workspace', scopeId: 'default' },
      selection: { skillIds: ['stale'], toolIds: [] },
    })
    await first
    expect(controller.selection.value.skillIds).toEqual(['new-scope'])
    controller.dispose()
  })
  it('rejects a preview if the user changed the selection while it was resolving', async () => {
    const response = deferred<Awaited<ReturnType<ExtensionsGateway['resolve']>>>()
    const controller = createSelectionController(gateway({ resolve: () => response.promise }))
    await controller.load(scope)
    const resolving = controller.resolve('develop')
    controller.selection.value.skillIds = ['changed']
    response.resolve({
      snapshot: {
        schemaVersion: 1,
        workspace: 'coding',
        catalogRevision: 1,
        policyEpoch: 0,
        skills: [],
        servers: [],
        tools: [],
        snapshotDigest: 'old',
      },
      totalToolCount: 7,
      estimatedContextTokens: 0,
    })
    expect(await resolving).toBe(false)
    expect(controller.preview.value).toBeNull()
    expect(controller.error.value).toContain('选择已改变')
  })
  it('retains the draft on a concurrent binding conflict', async () => {
    const controller = createSelectionController(
      gateway({
        saveBinding: async () => {
          throw new Error('EXTENSION_REVISION_CONFLICT')
        },
      }),
    )
    await controller.load(scope)
    controller.selection.value.skillIds = ['unsaved']
    expect(await controller.saveDefault()).toBe(false)
    expect(controller.selection.value.skillIds).toEqual(['unsaved'])
    expect(controller.error.value).toContain('当前草稿已保留')
  })
  it('previews a local Skill before publishing and pins the reviewed digest', async () => {
    const preview: SkillInspection = {
      skill: {
        id: 'preview',
        revision: 1,
        digest: 'reviewed-digest',
        name: 'example',
        description: 'Example method',
        source: 'local-import',
        sourceRef: 'example',
        enabled: true,
        workspaces: ['coding'],
        requiredCapabilities: [],
        files: [{ relativePath: 'SKILL.md', digest: 'file', size: 12 }],
      },
      body: 'Reviewed body',
      diagnostics: [],
    }
    const api = gateway({
      previewSkill: vi.fn(async () => preview),
      importSkill: vi.fn(async () => ({
        mutationId: 'receipt',
        targetId: 'installed',
        revision: 1,
      })),
    })
    const controller = createExtensionsController(api, async () => '/chosen/example')
    await controller.importSkill(['coding'])
    expect(api.importSkill).not.toHaveBeenCalled()
    expect(controller.importPreview.value?.body).toBe('Reviewed body')
    await controller.publishImport()
    expect(api.importSkill).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDigest: 'reviewed-digest', path: '/chosen/example' }),
    )
    expect(controller.importPreview.value).toBeNull()
  })
  it('keeps an actionable connection failure after reloading the catalog', async () => {
    const api = gateway({
      test: async () => ({
        id: 'test',
        serverId: 's',
        state: 'failed',
        errorCode: 'MCP_AUTH_REQUIRED',
        inventory: null,
      }),
    })
    const controller = createExtensionsController(api, async () => null)
    await controller.test({
      id: 's',
      revision: 1,
      digest: 'x',
      name: 'server',
      enabled: true,
      allowedTools: [],
      readOnlyTools: [],
      credentialConfigured: false,
      transport: {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        authMode: 'none',
        publicHeaders: {},
        secretRefs: {},
      },
    })
    expect(controller.error.value).toContain('服务要求认证')
  })
})
