import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPi } from '../dist/adapters/pi-session.js'

test('real Pi exposes assistant text before the provider finishes and uses the same identity for final text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-live-'))
  let release, received
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const first = new Promise((resolve) => {
    received = resolve
  })
  const frame = (delta, finish_reason = null) =>
    `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume */
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(frame({ role: 'assistant', content: '开始处理' }))
    await gate
    res.write(frame({ content: '，已完成。' }))
    res.end(frame({}, 'stop') + 'data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  let opened
  try {
    opened = await openPi({
      directory,
      project: { path: directory, instructions: '' },
      session: { id: 's', piPath: null },
      provider: {
        modelId: 'fixture',
        token: 'test',
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        contextWindow: 4096,
      },
      context: {
        root: directory,
        mode: 'analyze',
        workspace: {},
        invoke: async (_id, _name, run) => run(),
        command: async () => {},
        authorizeTool: async () => {},
        authorizeWrite: async () => {},
        changed() {},
      },
    })
    const events = []
    opened.session.subscribe((event) => {
      events.push(event)
      if (event.type === 'assistant.delta') received()
    })
    const task = opened.session.prompt('hello')
    await Promise.race([
      first,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('No live text before completion')), 5000)
        timer.unref()
      }),
    ])
    assert.equal(events.find((item) => item.type === 'assistant.delta').text, '开始处理')
    assert.equal(
      events.some((item) => item.type === 'assistant.message'),
      false,
    )
    release()
    await task
    const partial = events.find((item) => item.type === 'assistant.delta'),
      final = events.find((item) => item.type === 'assistant.message')
    assert.equal(final.text, '开始处理，已完成。')
    assert.equal(final.data.messageId, partial.data.messageId)
    assert.equal(final.data.streaming, false)
  } finally {
    release()
    await opened?.session.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
