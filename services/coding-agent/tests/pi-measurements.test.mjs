import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPi } from '../dist/adapters/pi-session.js'
import { ProviderMeasurements } from '../dist/adapters/provider-measurements.js'

const stats = {
  source: 'mlx-vlm',
  generationTokens: 7,
  generationTps: 25.5,
  promptTokens: 200,
  promptTps: 100,
  cachedTokens: 84,
  prefillTokens: 116,
  draftMode: 'mtp',
  prefillMs: 125,
  firstTokenMs: 150,
  durationMs: 500,
}
const usage = { prompt_tokens: 200, completion_tokens: 7, total_tokens: 207 }
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`
const metadata = (value = stats) => ({ choices: [], usage, ownloom: { generationStats: value } })

test('native Pi passes committed measurements to the successful turn without leaking into the next', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-measurements-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let request = 0
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume */
    }
    request++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(
      frame({
        id: 'test',
        object: 'chat.completion.chunk',
        choices: [
          { index: 0, delta: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' },
        ],
      }),
    )
    if (request !== 2) res.write(frame(metadata()))
    else res.write(frame({ choices: [], usage }))
    // A provider failure after metadata must still not publish successful measurements.
    if (request === 3) res.end(`event: error\n${frame({ error: { message: 'fixture failure' } })}`)
    else res.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const opened = await openPi({
    directory,
    project: { path: directory, instructions: '' },
    session: { id: 'measurements', piPath: null },
    provider: {
      modelId: 'fixture',
      token: 'test',
      contextWindow: 4096,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
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
  t.after(() => opened.session.close())
  const events = []
  opened.session.subscribe((event) => events.push(event))
  await opened.session.prompt('first')
  assert.deepEqual(
    events.find((event) => event.type === 'assistant.message').data.generationStats,
    stats,
  )
  assert.ok(
    events
      .filter((event) => event.type === 'assistant.delta')
      .every((event) => !event.data.generationStats),
  )
  events.length = 0
  await opened.session.prompt('second')
  assert.equal(opened.session.lastStopReason(), 'stop')
  assert.equal(
    events.find((event) => event.type === 'assistant.message').data.generationStats,
    undefined,
  )
  events.length = 0
  await opened.session.prompt('third')
  const failed = events.find((event) => event.type === 'assistant.message')
  assert.equal(failed.data.stopReason, 'error')
  assert.equal(failed.data.generationStats, undefined)
})

test('tool-only success retains scalar measurements while failed or malformed frames stay unknown', () => {
  const measurements = new ProviderMeasurements()
  measurements.begin()
  measurements.observe(metadata())
  assert.deepEqual(measurements.finish('toolUse'), stats)
  for (const reason of ['length', 'error', 'aborted'])
    assert.equal(measurements.finish(reason), undefined)
  measurements.begin()
  assert.equal(measurements.finish('stop'), undefined)
  for (const extension of [undefined, null, false, [], 'unsupported', { generationStats: [] }]) {
    measurements.observe({ choices: [], usage, ownloom: extension })
    assert.equal(measurements.finish('stop'), undefined)
  }
  measurements.observe(metadata({ source: 'mlx-vlm', generationTps: { private: 'payload' } }))
  assert.equal(measurements.finish('stop'), undefined)
  measurements.observe(
    metadata({ ...stats, generationTps: Infinity, unrecognized: { secret: true } }),
  )
  assert.equal(measurements.finish('stop').generationTps, null)
  assert.equal(measurements.finish('stop').unrecognized, undefined)
})
