import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPi } from '../dist/adapters/pi-session.js'

for (const defect of ['missing', 'extra'])
  test(`native Pi corrects ${defect} arguments within one prompt without replaying writes`, async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'coding-pi-recovery-')))
    t.after(() => rm(root, { recursive: true, force: true }))
    const requests = [],
      writes = [],
      events = []
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const part of req) body += part
      requests.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const write = requests.length < 4
      const delta = write
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call-${requests.length}`,
                type: 'function',
                function: {
                  name: 'write',
                  arguments: JSON.stringify({
                    path: requests.length === 1 ? 'first.js' : 'second.js',
                    ...(requests.length !== 2 || defect === 'extra'
                      ? { content: 'export default 1' }
                      : {}),
                    ...(requests.length === 2 && defect === 'extra'
                      ? { unexpected: 'preserve for validation' }
                      : {}),
                  }),
                },
              },
            ],
          }
        : { role: 'assistant', content: '完成' }
      res.end(
        `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: write ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      )
    })
    t.after(async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const opened = await openPi({
      directory: join(root, 'data'),
      project: { path: root, instructions: '' },
      session: { id: 'recovery', piPath: null },
      provider: {
        modelId: 'fixture',
        token: 'test',
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        contextWindow: 32768,
      },
      context: {
        root,
        mode: 'develop',
        workspace: {
          write: async (path) => {
            writes.push(path)
            return 'hash'
          },
        },
        invoke: async (_id, _name, execute) => execute(),
        command: async () => {
          throw new Error('Unexpected command')
        },
        authorizeWrite: async () => {},
        changed() {},
      },
    })
    t.after(() => opened.session.close())
    opened.session.subscribe((event) => events.push(event))
    await opened.session.prompt('Create two files')
    assert.deepEqual(writes, ['first.js', 'second.js'])
    assert.equal(
      events.filter((event) => event.type === 'tool.finished' && event.data.isError).length,
      1,
    )
    assert.equal(opened.session.lastStopReason(), 'stop')
    assert.equal(requests.length, 4)
    assert.ok(
      requests[2].messages.some(
        (message) => message.role === 'tool' && message.content.includes('hash'),
      ),
    )
    assert.ok(
      requests[2].messages.some(
        (message) =>
          message.role === 'tool' &&
          message.content.includes('Validation failed') &&
          message.content.includes(defect === 'missing' ? 'content' : 'unexpected'),
      ),
    )
    assert.ok(
      requests.every(
        (request) =>
          request.max_tokens === null &&
          request.output_budget === 'remaining' &&
          request.context_limit === 32768,
      ),
    )
    await opened.session.prompt('Synthetic history: ' + 'x'.repeat(40000))
    await opened.session.prompt('Finish the synthetic history')
    await opened.session.compact()
    assert.equal(requests.at(-1).output_budget, undefined)
    assert.equal(requests.at(-1).context_limit, undefined)
    assert.ok(requests.at(-1).max_tokens > 0)
  })
