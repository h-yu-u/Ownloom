import { describe, expect, it, vi } from 'vitest'
import type { ExtensionServer, McpWriteRequest, ExtensionMutation } from '@mlx-studio/api-client'
import { createMcpEditorController } from './mcp-editor-controller'
import type { ExtensionsGateway } from '../application/ports'
const server: ExtensionServer = {
  id: 'server',
  revision: 1,
  digest: '',
  name: 'test',
  enabled: false,
  credentialConfigured: false,
  transport: {
    type: 'stdio',
    executable: '/bin/node',
    cwd: '/tmp',
    args: [],
    publicEnv: {},
    secretRefs: {},
  },
  allowedTools: [],
  readOnlyTools: [],
}
const body: McpWriteRequest = {
  mutationId: 'mutation',
  expectedRevision: 0,
  name: 'test',
  enabled: false,
  transport: { type: 'stdio', executable: '/bin/node', cwd: '/tmp' },
  credential: { action: 'keep' },
}
const receipt: ExtensionMutation = { mutationId: 'mutation', targetId: 'server', revision: 1 }
function fixture() {
  const gateway: ExtensionsGateway = {
    catalog: vi.fn(),
    skill: vi.fn(),
    previewSkill: vi.fn(),
    importSkill: vi.fn(),
    toggleSkill: vi.fn(),
    saveServer: vi.fn(async () => receipt),
    server: vi.fn(async () => server),
    inventory: vi.fn(),
    mutation: vi.fn(async () => receipt),
    test: vi.fn(),
    operation: vi.fn(),
    cancelOperation: vi.fn(),
    binding: vi.fn(),
    saveBinding: vi.fn(),
    resolve: vi.fn(),
    revoke: vi.fn(),
  }
  const refresh = vi.fn(async () => {})
  return { gateway, refresh, editor: createMcpEditorController(gateway, refresh) }
}
describe('MCP commit receipts', () => {
  it('keeps a receipt when normalized config read fails and retries only the read', async () => {
    const f = fixture()
    vi.mocked(f.gateway.server).mockRejectedValueOnce(new Error('offline'))
    expect(await f.editor.save(body)).toMatchObject({ kind: 'saved-pending-refresh', receipt })
    expect(f.editor.locked.value).toBe(true)
    expect((await f.editor.save(body)).kind).toBe('saved')
    expect(f.gateway.saveServer).toHaveBeenCalledOnce()
    expect(f.gateway.server).toHaveBeenCalledTimes(2)
  })
  it('recovers an unknown response through the original mutation receipt without recreating it', async () => {
    const f = fixture()
    vi.mocked(f.gateway.saveServer).mockRejectedValueOnce(new Error('lost response'))
    expect(await f.editor.save(body)).toMatchObject({ kind: 'uncertain', mutationId: 'mutation' })
    expect((await f.editor.save(body)).kind).toBe('saved')
    expect(f.gateway.mutation).toHaveBeenCalledWith('mutation')
    expect(f.gateway.saveServer).toHaveBeenCalledOnce()
  })
  it('reports a list refresh failure separately from a completed save', async () => {
    const f = fixture()
    f.refresh.mockRejectedValueOnce(new Error('list offline'))
    expect(await f.editor.save(body)).toMatchObject({
      kind: 'saved',
      value: server,
      refreshWarning: expect.any(String),
    })
  })
})
