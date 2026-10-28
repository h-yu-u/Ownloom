import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../../', import.meta.url))
const runner = fileURLToPath(new URL('../run.mjs', import.meta.url))
function simulatedGrandchild() {
  const { appendFileSync } = require('node:fs')
  const record = (event) =>
    appendFileSync(process.env.OWNLOOM_TASK_LOG, JSON.stringify({ event }) + '\n')
  process.on('SIGTERM', () => {
    record('grandchild-stopped')
    process.exit(0)
  })
  record('ready')
  setInterval(() => {}, 1000)
}

function simulatedTool() {
  const { appendFileSync } = require('node:fs')
  const { spawn } = require('node:child_process')
  const record = (value) =>
    appendFileSync(process.env.OWNLOOM_TASK_LOG, JSON.stringify(value) + '\n')
  record({
    event: 'call',
    args: process.argv.slice(2),
    cwd: process.cwd(),
    inherited: process.env.OWNLOOM_TASK_VALUE,
    pythonPath: process.env.PYTHONPATH,
    ci: process.env.CI,
  })
  if (process.env.OWNLOOM_TASK_MODE === 'fail') process.exit(23)
  if (process.env.OWNLOOM_TASK_MODE === 'signal') process.kill(process.pid, 'SIGTERM')
  if (process.env.OWNLOOM_TASK_MODE === 'wait') {
    const child = spawn(process.execPath, ['-e', process.env.OWNLOOM_TASK_CHILD_SOURCE], {
      stdio: 'inherit',
    })
    process.on('SIGTERM', () => child.once('close', () => process.exit(0)))
  }
}
const tool = `#!${process.execPath}\n(${simulatedTool.toString()})()\n`

async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ownloom-command-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bin = join(directory, 'bin')
  const log = join(directory, 'calls.jsonl')
  await mkdir(bin)
  for (const program of ['pnpm', 'uv', 'bash']) {
    const path = join(bin, program)
    await writeFile(path, tool)
    await chmod(path, 0o755)
  }
  const env = {
    ...process.env,
    PATH: bin,
    OWNLOOM_TASK_LOG: log,
    OWNLOOM_TASK_VALUE: 'inherited value',
    OWNLOOM_TASK_CHILD_SOURCE: `(${simulatedGrandchild.toString()})()`,
    ...extra,
  }
  return {
    directory,
    env,
    run: (...args) =>
      spawnSync(process.execPath, [runner, ...args], {
        cwd: directory,
        env,
        encoding: 'utf8',
        timeout: 10000,
      }),
    async records() {
      try {
        return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
  }
}

test('help does not execute commands, including verification target help', async (t) => {
  const work = await fixture(t)
  for (const args of [
    [],
    ['--help'],
    ['build', '--help'],
    ['verify', '--help'],
    ['verify', 'chat', '--help'],
  ]) {
    const result = work.run(...args)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage:/)
  }
  assert.deepEqual(await work.records(), [])
})

test('missing required targets, unknown targets, and unaccepted arguments fail before execution', async (t) => {
  const work = await fixture(t)
  for (const args of [
    ['build'],
    ['generate'],
    ['verify'],
    ['unknown'],
    ['check', 'unknown'],
    ['check', 'runtime', '--unexpected'],
  ]) {
    const result = work.run(...args)
    assert.equal(result.status, 2, result.stderr)
  }
  assert.deepEqual(await work.records(), [])
})

test('dev web builds the Host before starting Vite', async (t) => {
  const work = await fixture(t)
  const result = work.run('dev', 'web')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    (await work.records()).map(({ args }) => args),
    [
      ['--filter', '@mlx-studio/coding-agent', 'build'],
      ['--filter', '@mlx-studio/desktop', 'dev'],
    ],
  )
})

test('the first child failure preserves its exit code and stops later commands', async (t) => {
  const work = await fixture(t, { OWNLOOM_TASK_MODE: 'fail' })
  const result = work.run('dev', 'web')
  assert.equal(result.status, 23, result.stderr)
  assert.equal((await work.records()).length, 1)
})

test('verification preserves arguments, inherited environment, and repository cwd', async (t) => {
  const work = await fixture(t, { PYTHONPATH: '/inherited/python' })
  const args = ['--model-path', '/a path/with spaces;$(not-a-shell)', '--output', 'result.json']
  const result = work.run('verify', 'chat', '--', ...args)
  assert.equal(result.status, 0, result.stderr)
  const [call] = await work.records()
  assert.deepEqual(call.args, [
    'run',
    '--project',
    'services/runtime',
    '--python',
    '3.12',
    'python',
    '-m',
    'scripts.verify.verify_local_chat',
    ...args,
  ])
  assert.equal(call.cwd, root.replace(/\/$/, ''))
  assert.equal(call.inherited, 'inherited value')
  assert.equal(
    call.pythonPath,
    [join(root, 'services/runtime/src'), '/inherited/python'].join(delimiter),
  )
})

test('explicit script help reaches the verification program', async (t) => {
  const work = await fixture(t)
  const result = work.run('verify', 'chat', '--', '--help')
  assert.equal(result.status, 0, result.stderr)
  assert.equal((await work.records())[0].args.at(-1), '--help')
})

test('app build preserves environment and sets CI only for Tauri', async (t) => {
  const work = await fixture(t, { CI: 'caller-value' })
  const result = work.run('build', 'app')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    (await work.records()).map(({ ci }) => ci),
    ['caller-value', 'caller-value', 'caller-value', 'true'],
  )
})

test('a missing executable returns failure instead of a successful null status', async (t) => {
  const work = await fixture(t, { PATH: '' })
  const result = work.run('generate', 'api')
  assert.equal(result.status, 127, result.stderr)
  assert.match(result.stderr, /Cannot run pnpm/)
})

test('a child terminated by a signal terminates the runner with that signal', async (t) => {
  const work = await fixture(t, { OWNLOOM_TASK_MODE: 'signal' })
  const result = work.run('dev', 'web')
  assert.equal(result.signal, 'SIGTERM', result.stderr)
  assert.equal((await work.records()).length, 1)
})

test(
  'interrupting a running command stops its process group and prevents the next step',
  {
    skip: process.platform === 'win32',
    timeout: 10000,
  },
  async (t) => {
    const work = await fixture(t, { OWNLOOM_TASK_MODE: 'wait' })
    const child = spawn(process.execPath, [runner, 'dev', 'web'], {
      cwd: work.directory,
      env: work.env,
      stdio: 'ignore',
    })
    t.after(() => child.kill('SIGKILL'))
    const exited = new Promise((resolve) =>
      child.once('close', (code, signal) => resolve({ code, signal })),
    )
    const until = Date.now() + 5000
    while (!(await work.records()).some(({ event }) => event === 'ready')) {
      assert.ok(Date.now() < until, 'fixture did not start')
      await delay(20)
    }
    child.kill('SIGTERM')
    assert.equal((await exited).signal, 'SIGTERM')
    const records = await work.records()
    assert.equal(records.filter(({ event }) => event === 'call').length, 1)
    assert.ok(records.some(({ event }) => event === 'grandchild-stopped'))
  },
)
