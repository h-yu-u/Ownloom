import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { openPi } from '../dist/adapters/pi-session.js'
import { McpConnections } from '../dist/adapters/extensions/transport.js'
import { ToolGateway } from '../dist/application/tool-gateway.js'
const base = {
  id: 's_fixture',
  revision: 1,
  digest: 'cfg',
  name: 'Fixture',
  enabled: true,
  allowedTools: ['lookup'],
  readOnlyTools: ['lookup'],
  credentialConfigured: false,
  transport: {
    type: 'stdio',
    executable: process.execPath,
    args: [resolve('tests/fixtures/mcp-server.mjs')],
    cwd: process.cwd(),
    publicEnv: {},
    secretRefs: {},
  },
}
async function httpFixture(t, handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}
for (const disconnect of [false, true])
  test(`Pi execute gate preserves isolation and closes stdio (disconnect=${disconnect})`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'mlx-pi-extensions-')),
      project = join(directory, 'project'),
      processes = [],
      requests = []
    await mkdir(join(project, '.pi', 'extensions'), { recursive: true })
    const sentinel = join(directory, 'executed')
    await writeFile(
      join(project, '.pi', 'extensions', 'sentinel.mjs'),
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(sentinel)},'bad');export default ()=>{}`,
    )
    await writeFile(join(project, '.pi', 'skills.md'), 'unapproved skill sentinel')
    t.after(() => rm(directory, { recursive: true, force: true }))
    const inventory = await new McpConnections().inspect(base, {}, new AbortController().signal)
    const tool = inventory.tools.find((tool) => tool.originalName === 'lookup')
    const snapshot = {
      schemaVersion: 1,
      workspace: 'coding',
      catalogRevision: 1,
      policyEpoch: 0,
      skills: [],
      servers: [base],
      tools: [tool],
      snapshotDigest: 'snapshot',
    }
    const url = await httpFixture(t, async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)
      requests.push(parsed)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const delta =
        requests.length === 1
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-one',
                  type: 'function',
                  function: {
                    name: tool.modelName,
                    arguments: JSON.stringify({ query: disconnect ? 'disconnect' : 'contract' }),
                  },
                },
              ],
            }
          : { content: 'Verified result.' }
      res.end(
        `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      )
    })
    const calls = [],
      gateway = new ToolGateway({
        check() {},
        started: (...args) => calls.push(['start', ...args]),
        finished: (...args) => calls.push(['end', ...args]),
      })
    const opened = await openPi({
      directory,
      project: {
        id: 'p',
        name: 'project',
        path: project,
        git: false,
        commands: [],
        instructions: 'approved root instructions',
      },
      session: { id: 's', projectId: 'p', piPath: null },
      provider: { modelId: 'fixture', token: 'local-only', baseUrl: url, contextWindow: 32768 },
      context: {
        root: project,
        mode: 'analyze',
        invoke: (...args) => gateway.invoke(...args),
        authorizeTool: async () => {},
        workspace: {},
        command: async () => {},
        authorizeWrite: async () => {},
        changed() {},
      },
      snapshot,
      extensions: { check() {}, read: async () => '', resolve: () => ({ snapshot }) },
      processEvent: (pid, state) => processes.push([pid, state]),
    })
    try {
      await opened.session.prompt('/skill:unapproved /mcp login\nFind a document.')
    } finally {
      await opened.session.close()
      await opened.session.close()
    }
    assert.equal(opened.session.lastErrorCode(), undefined)
    assert.equal(requests.length, 2)
    assert.equal(calls.filter((call) => call[0] === 'start').length, 1)
    assert.equal(calls.filter((call) => call[0] === 'end').length, 1)
    assert.match(JSON.stringify(requests[1]), disconnect ? /MCP_RESULT_UNKNOWN/ : /found contract/)
    assert.equal(
      calls.find((call) => call[0] === 'end')[3],
      disconnect ? 'MCP_RESULT_UNKNOWN' : null,
    )
    assert.doesNotMatch(JSON.stringify(requests), /unapproved skill sentinel/)
    assert.match(JSON.stringify(requests), /approved root instructions/)
    await assert.rejects(access(sentinel))
    assert.deepEqual(
      processes.map((event) => event[1]),
      ['start', 'end'],
    )
    assert.equal(processes[0][0], processes[1][0])
  })
test('HTTP authentication failure does not invoke OAuth or write mcp-auth.json', async (t) => {
  const url = await httpFixture(t, (_req, res) => {
    res.writeHead(401, {
      'www-authenticate': 'Bearer resource_metadata="https://invalid.test/oauth"',
    })
    res.end('private secret')
  })
  const server = {
    ...base,
    id: 's_auth',
    transport: {
      type: 'streamable-http',
      url,
      publicHeaders: {},
      secretRefs: {},
      authMode: 'none',
    },
  }
  await assert.rejects(
    new McpConnections().inspect(server, {}, new AbortController().signal),
    /MCP_AUTH_REQUIRED/,
  )
})
