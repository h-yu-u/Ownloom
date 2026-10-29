import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queryProgress } from '../dist/domain/query-progress.js'
import { tools } from '../dist/adapters/tools.js'

test('recognizes repeated metadata queries despite changing output filters, without caching or blocking them', () => {
  let state
  for (const [index, filter] of ['sass', 'sass|css', 'sass|css|vue'].entries()) {
    const next = queryProgress(
      state,
      `npm view @vue/cli-service@5 dependencies | grep -E "${filter}"`,
      { exitCode: 0 },
    )
    state = next.state
    assert.equal(!!next.notice, index === 2)
  }
  assert.equal(state.count, 3)
  assert.equal(queryProgress(state, 'npm view vue version', { exitCode: 0 }).notice, undefined)
  assert.equal(
    queryProgress(state, 'npm view @vue/cli-service@5 dependencies', { exitCode: 1 }).state,
    undefined,
  )
  assert.equal(queryProgress(state, 'npm run test', { exitCode: 0 }).state, undefined)
  assert.equal(
    queryProgress(state, 'npm view vue version && npm install', { exitCode: 0 }).state,
    undefined,
  )
})

test('managed tools return real results and reset the query reminder after a file change; sessions do not share it', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'coding-query-progress-'))
  const root = await realpath(temporary)
  t.after(() => rm(temporary, { recursive: true, force: true }))
  let commands = 0,
    authorizedWrites = 0
  const context = {
    root,
    mode: 'develop',
    invoke: async (_id, _name, execute) => execute(),
    command: async () => {
      commands++
      return { exitCode: 0, output: 'actual metadata', truncated: false }
    },
    authorizeWrite: async () => {
      authorizedWrites++
    },
    workspace: { write: async () => 'new hash' },
    changed() {},
  }
  const selected = tools(context)
  const run = selected.find((tool) => tool.name === 'run_command')
  const call = async (tool = run) =>
    JSON.parse(
      (await tool.execute(String(commands), { command: 'npm view vue version' })).content[0].text,
    )
  assert.equal((await call()).progressNotice, undefined)
  assert.equal((await call()).progressNotice, undefined)
  const repeated = await call()
  assert.equal(repeated.output, 'actual metadata')
  assert.match(repeated.progressNotice, /already succeeded 3 times/)
  assert.equal(commands, 3)
  assert.equal(
    (await call(tools(context).find((tool) => tool.name === 'run_command'))).progressNotice,
    undefined,
  )
  await selected
    .find((tool) => tool.name === 'write')
    .execute('write', { path: 'new.txt', content: 'new', expectedHash: null })
  assert.equal(authorizedWrites, 1)
  assert.equal((await call()).progressNotice, undefined)
})
