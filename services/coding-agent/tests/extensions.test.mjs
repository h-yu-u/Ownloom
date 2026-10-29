import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ExtensionsRepository } from '../dist/adapters/extensions/repository.js'
import { ManagedSkillFiles, digest } from '../dist/adapters/extensions/skill-files.js'
import {
  McpConnections,
  guardedTransport,
  invocation,
} from '../dist/adapters/extensions/transport.js'
import { Extensions } from '../dist/extensions/application/service.js'
import { ToolGateway } from '../dist/application/tool-gateway.js'
import { McpClient } from '@earendil-works/pi-mcp'
const root = { workspace: 'coding', kind: 'workspace', scopeId: 'default' }
const empty = { skillIds: [], toolIds: [] }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mlx-extensions-')),
    source = join(directory, 'simple')
  await mkdir(source)
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: simple\ndescription: A selected method\n---\nAlways verify the result.\n',
  )
  await mkdir(join(source, 'references'))
  await writeFile(join(source, 'references', 'guide.md'), 'Reference text')
  const repo = new ExtensionsRepository(directory),
    files = new ManagedSkillFiles(join(directory, 'managed'))
  const service = new Extensions({
    repo,
    files,
    digest,
    mcp: new McpConnections(),
    revokeRuns: async () => {},
  })
  t.after(async () => {
    await service.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, source, repo, files, service }
}
test('managed skill versions, content verification, path rejection and durable mutation receipts', async (t) => {
  const { service, repo, files, source, directory } = await fixture(t)
  const request = {
    mutationId: 'import',
    path: source,
    workspaces: ['coding', 'chat'],
    requiredCapabilities: [],
  }
  const imported = await service.dispatch('extensions.skills.import', request)
  assert.deepEqual(await service.dispatch('extensions.skills.import', request), imported)
  await assert.rejects(
    service.dispatch('extensions.skills.import', { ...request, workspaces: ['image'] }),
    /IDEMPOTENCY_CONFLICT/,
  )
  const skill = repo.skill(imported.targetId)
  assert.equal(await files.read(skill, 'references/guide.md'), 'Reference text')
  for (const path of ['../secret', '/etc/passwd', 'references/../SKILL.md', 'references\\guide.md'])
    await assert.rejects(files.read(skill, path), /SKILL_PATH_NOT_ALLOWED/)
  await symlink('/etc/passwd', join(source, 'link'))
  await assert.rejects(
    service.dispatch('extensions.skills.import', { ...request, mutationId: 'symlink' }),
    /SKILL_PATH_NOT_ALLOWED/,
  )
  const path = join(directory, 'managed', skill.id, '1', 'references', 'guide.md')
  await chmod(path, 0o600)
  await writeFile(path, 'tampered')
  await assert.rejects(files.read(skill, 'references/guide.md'), /SKILL_CONTENT_CHANGED/)
})
test('snapshot selection is immutable and revocation only invalidates older authorizations', async (t) => {
  const { service, repo, source, files } = await fixture(t)
  const imported = await service.dispatch('extensions.skills.import', {
    mutationId: 'import',
    path: source,
    workspaces: ['coding'],
    requiredCapabilities: [],
  })
  const selection = { ...empty, skillIds: [imported.targetId] }
  const original = service.resolver.resolve(root, selection, 'develop').snapshot
  await service.dispatch('extensions.skills.update', {
    mutationId: 'disable',
    id: imported.targetId,
    expectedRevision: 1,
    enabled: false,
  })
  assert.equal(original.skills[0].enabled, true)
  const disabled = repo.skill(imported.targetId)
  assert.equal(disabled.revision, 2)
  assert.equal(disabled.contentRevision, 1)
  assert.match(await files.read(disabled, 'SKILL.md'), /Always verify the result/)
  assert.doesNotThrow(() => service.resolver.check(original))
  assert.throws(() => service.resolver.resolve(root, selection), /SKILL_NOT_AVAILABLE/)
  await service.dispatch('extensions.revoke', { mutationId: 'revoke', targetId: imported.targetId })
  await service.dispatch('extensions.revoke', { mutationId: 'revoke', targetId: imported.targetId })
  assert.equal(repo.catalog().policyEpoch, 1)
  assert.throws(() => service.resolver.check(original), /CAPABILITY_REVOKED/)
  assert.equal(repo.events(0).events.length, 3)
})
test('extension admission reserves the same Coding output budget as Pi', async (t) => {
  const { service, source } = await fixture(t)
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: simple\ndescription: A selected method\n---\n' + 'x'.repeat(25000),
  )
  const imported = await service.dispatch('extensions.skills.import', {
    mutationId: 'large-skill',
    path: source,
    workspaces: ['coding', 'chat'],
    requiredCapabilities: [],
  })
  const selection = { ...empty, skillIds: [imported.targetId] }
  assert.throws(
    () => service.resolver.resolve(root, selection, 'develop', 32768),
    /EXTENSION_CONTEXT_BUDGET_EXCEEDED/,
  )
  assert.doesNotThrow(() =>
    service.resolver.resolve({ ...root, workspace: 'chat' }, selection, 'develop', 32768, true),
  )
})
test('execute gateway closes exactly one call for success, failure, cancellation and duplicate IDs', async () => {
  const events = []
  const gateway = new ToolGateway({
    check() {},
    started: (...args) => events.push(['start', ...args]),
    finished: (...args) => events.push(['end', ...args]),
  })
  await gateway.invoke('a', 'read', async () => 1)
  await assert.rejects(
    gateway.invoke('b', 'read', async () => {
      throw new Error('CANCELLED')
    }),
    /CANCELLED/,
  )
  await assert.rejects(
    gateway.invoke('a', 'read', async () => 1),
    /DUPLICATE_TOOL_ID/,
  )
  assert.equal(events.filter((event) => event[0] === 'start').length, 2)
  assert.equal(events.filter((event) => event[0] === 'end').length, 2)
})
function server() {
  return {
    id: 's_fixture',
    revision: 1,
    digest: 'cfg',
    name: 'Fixture',
    enabled: true,
    allowedTools: ['lookup'],
    readOnlyTools: ['lookup'],
    credentialConfigured: true,
    transport: {
      type: 'stdio',
      executable: process.execPath,
      args: [resolve('tests/fixtures/mcp-server.mjs')],
      cwd: process.cwd(),
      publicEnv: {},
      secretRefs: { SECRET: 'private-reference' },
    },
  }
}
test('native MCP stdio discovery, stable collision mapping, transport admission, output filtering and process cleanup', async () => {
  const owner = server(),
    secrets = { SECRET: 'fixture-secret' },
    processes = []
  const inventory = await new McpConnections((pid, state) => processes.push([pid, state])).inspect(
    owner,
    secrets,
    new AbortController().signal,
  )
  assert.equal(inventory.tools.length, 3)
  assert.notEqual(inventory.tools[1].modelName, inventory.tools[2].modelName)
  assert.equal(
    inventory.tools.every((tool) => /^[A-Za-z0-9_]{1,64}$/.test(tool.modelName)),
    true,
  )
  assert.equal(processes.length, 2)
  assert.equal(processes[0][0], processes[1][0])
  const tool = inventory.tools[0],
    transport = guardedTransport({ server: owner, secrets, generation: 1, check() {} }),
    client = new McpClient({ name: 'test', version: '1', requestTimeoutMs: 2000 })
  try {
    await client.connect(transport)
    await assert.rejects(client.callTool('lookup', { query: 'test' }), /MCP_ADMISSION_REQUIRED/)
    async function call(query) {
      return invocation.run({ tool, args: { query }, generation: 1 }, () =>
        client.callTool('lookup', { query }),
      )
    }
    assert.equal((await call('test')).content[0].text, 'found test')
    assert.equal((await call('secret')).content[0].text, '[redacted]')
    assert.equal((await call('error')).isError, true)
    await assert.rejects(call('large'), /MCP_RESULT_TOO_LARGE/)
    await assert.rejects(call('media'), /MCP_RESULT_UNSUPPORTED/)
  } finally {
    await client.close()
    await transport.close()
  }
})
