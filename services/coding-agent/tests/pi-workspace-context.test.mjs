import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPi } from '../dist/adapters/pi-session.js'

test(
  'Pi receives an observed empty-project hint only for an empty development workspace',
  { timeout: 10000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coding-workspace-hint-'))
    const requests = []
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      requests.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      )
    })
    server.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const input = (root, mode) => ({
      directory: join(directory, 'data'),
      project: { path: root, instructions: '' },
      session: { id: mode + requests.length, piPath: null },
      provider: {
        modelId: 'fixture',
        token: 'test',
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        contextWindow: 4096,
      },
      context: {
        root,
        mode,
        workspace: {},
        invoke: async (_id, _name, execute) => execute(),
        command: async () => {},
        authorizeTool: async () => {},
        authorizeWrite: async () => {},
        changed() {},
      },
    })
    try {
      const empty = join(directory, 'empty'),
        existing = join(directory, 'existing')
      await mkdir(empty)
      await mkdir(existing)
      await mkdir(join(empty, '.git'))
      await writeFile(join(empty, '.DS_Store'), '')
      await writeFile(join(existing, 'index.html'), 'existing content')
      for (const [root, mode, expected] of [
        [empty, 'develop', true],
        [existing, 'develop', false],
        [empty, 'review', false],
      ]) {
        const opened = await openPi(input(root, mode))
        try {
          await opened.session.prompt('Create a small project')
        } finally {
          await opened.session.close()
        }
        const messages = requests.at(-1).messages
        assert.equal(requests.at(-1).output_budget, 'remaining')
        assert.equal(requests.at(-1).context_limit, 4096)
        assert.equal(requests.at(-1).max_tokens, null)
        assert.equal(
          messages.some(
            (message) =>
              message.role === 'system' &&
              message.content.includes('Workspace observation from the host:'),
          ),
          expected,
        )
      }
      await assert.rejects(openPi(input(join(directory, 'missing'), 'develop')), { code: 'ENOENT' })
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    }
  },
)
