import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { cp } from 'node:fs/promises'
import { Repository } from '../dist/adapters/repository.js'
import { ExtensionsRepository } from '../dist/adapters/extensions/repository.js'
import { exportData } from '../dist/adapters/data-export.js'
import { restoreData } from '../dist/adapters/data-restore.js'
import { validateTranscript } from '../dist/adapters/transcript.js'
import { tmpdir } from 'node:os'
import { openPi } from '../dist/adapters/pi-session.js'
import { contextSettings } from '../dist/domain/context-budget.js'
import { fingerprint, files } from '../dist/adapters/workspace.js'
import { currentVersion } from '../dist/adapters/workspace-version.js'
import { promptAndVerify } from '../dist/application/run-verification.js'

test('small window reserve fits and manual compaction remains idle-only', () => {
  const budget = contextSettings(4096)
  assert.equal(budget.output, 512)
  assert.ok(budget.output + budget.keepRecentTokens + budget.reserveTokens < 4096)
})

test('real Pi treats text followed by SSE error as a failed turn with no tool execution', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mlx-pi-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume the provider request */
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(
      `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] })}\n\n`,
    )
    res.end(
      `event: error\ndata: ${JSON.stringify({ error: { type: 'server_error', code: 'INFERENCE_PROTOCOL_INCOMPLETE', message: 'INFERENCE_PROTOCOL_INCOMPLETE' } })}\n\n`,
    )
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  let executed = 0
  const opened = await openPi({
    directory,
    workspace: 'chat',
    root: directory,
    instructions: '',
    transcript: { id: 'session', piPath: null },
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
      invoke: async () => {
        executed++
      },
      command: async () => {},
      authorizeTool: async () => {},
      authorizeWrite: async () => {},
      changed() {},
    },
  })
  const allocated = await opened.session.checkpoint()
  assert.equal(allocated.state, 'allocated')
  await opened.session.prompt('hello')
  assert.equal(opened.session.lastStopReason(), 'error')
  assert.equal(executed, 0)
  const descriptor = await opened.session.checkpoint()
  assert.equal(descriptor.path, allocated.path)
  assert.equal(descriptor.state, 'materialized')
  assert.ok((await readFile(descriptor.path, 'utf8')).includes('hello'))
  await opened.session.close()
})

test('2001 files and large files do not block browsing; saved version detects external edits', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mlx-large-workspace-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  await Promise.all(
    Array.from({ length: 2001 }, (_, i) => writeFile(join(root, `${i}.txt`), String(i))),
  )
  assert.equal((await files(root)).length, 2001)
  let before = await fingerprint(root)
  // macOS may deliver creation events queued before the watcher was attached.
  if (before.startsWith('partial:unstable:')) before = await fingerprint(root)
  assert.equal(await currentVersion(root), before)
  await writeFile(join(root, '0.txt'), 'externally edited')
  assert.notEqual(await currentVersion(root), before)
  await mkdir(join(root, 'large'))
  const fs = await import('node:fs/promises')
  const huge = await fs.open(join(root, 'large', 'huge.bin'), 'w')
  await huge.truncate(65 * 1024 * 1024)
  await huge.close()
  assert.ok((await fingerprint(root)).startsWith('partial:'))
})

test('ordinary opt-in verification stops at repair limit and zero only verifies once', async () => {
  for (const limit of [0, 2]) {
    let prompts = 0,
      commands = 0
    await promptAndVerify({
      pi: {
        prompt: async () => {
          prompts++
        },
        lastStopReason: () => 'stop',
      },
      run: {
        text: 'task',
        mode: 'develop',
        verificationCommands: ['fixed-test'],
        maxRepairRounds: limit,
      },
      abort: new AbortController(),
      probe: false,
      verifyOnly: false,
      command: async (_id, command) => {
        assert.equal(command, 'fixed-test')
        commands++
        return { exitCode: 1 }
      },
      checks: () => [{ exitCode: 1 }],
    })
    assert.equal(prompts, 1 + limit)
    assert.equal(commands, 1 + limit)
  }
})

test('owner restore preserves raw Pi log, remaps descriptors and rejects a corrupt parent chain', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mlx-restore-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repo = new Repository(join(root, 'data', 'coding'))
  const agent = new Repository(join(repo.directory, 'agent-chat'), 'agent-chat.db')
  const extensions = new ExtensionsRepository(repo.directory)
  const path = join(agent.directory, 'fixture.jsonl')
  const bytes =
    JSON.stringify({ type: 'session', id: 'pi-id', cwd: agent.directory }) +
    '\n' +
    JSON.stringify({
      type: 'message',
      id: 'leaf',
      parentId: null,
      message: { role: 'user', content: 'fixture' },
    }) +
    '\n'
  await writeFile(path, bytes)
  agent.save('agentSession', {
    id: 'agent',
    title: 'fixture',
    piPath: path,
    transcript: {
      productSessionId: 'agent',
      piSessionId: 'pi-id',
      path,
      state: 'materialized',
      lastKnownEntryId: 'leaf',
    },
  })
  const exported = await exportData(repo, agent, extensions)
  repo.close()
  agent.close()
  extensions.close()
  const id = randomUUID(),
    target = join(root, 'profiles', id, 'data', 'coding')
  await cp(exported.directory, join(root, '.restore', id, 'verified', 'node'), { recursive: true })
  const previous = process.env.MLX_STUDIO_PROFILE_ROOT
  process.env.MLX_STUDIO_PROFILE_ROOT = root
  try {
    assert.deepEqual(await restoreData(id), { imported: true })
  } finally {
    if (previous === undefined) delete process.env.MLX_STUDIO_PROFILE_ROOT
    else process.env.MLX_STUDIO_PROFILE_ROOT = previous
  }
  const db = new DatabaseSync(join(target, 'agent-chat', 'agent-chat.db'))
  const session = JSON.parse(
    db.prepare("SELECT value FROM entities WHERE kind='agentSession'").get().value,
  )
  db.close()
  assert.equal(await readFile(session.piPath, 'utf8'), bytes)
  assert.equal(await readFile(path, 'utf8'), bytes)
  await validateTranscript(session.piPath, join(target, 'agent-chat'), session.transcript)
  await writeFile(session.piPath, bytes.replace('"parentId":null', '"parentId":"missing"'))
  await assert.rejects(
    validateTranscript(session.piPath, join(target, 'agent-chat'), session.transcript),
    /TRANSCRIPT_CORRUPT/,
  )
})

test(
  'first prompt hard kill recovers the pre-saved Pi path and interrupts the unfinished run',
  { timeout: 10000 },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'mlx-first-prompt-')))
    t.after(() => rm(root, { recursive: true, force: true }))
    const server = createServer(async (req, res) => {
      for await (const _ of req) {
        /* consume */
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        'data: ' +
          JSON.stringify({
            id: 'first',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'saved answer' },
                finish_reason: 'stop',
              },
            ],
          }) +
          '\n\ndata: [DONE]\n\n',
      )
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const provider = {
      modelId: 'fixture',
      token: 'test',
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      contextWindow: 4096,
    }
    const input = {
      directory: root,
      workspace: 'chat',
      root,
      instructions: '',
      transcript: { id: 'session', piPath: null },
      provider,
    }
    const script = String.raw`
    import { openPi } from ${JSON.stringify(new URL('../dist/adapters/pi-session.js', import.meta.url).href)};
    import { Repository } from ${JSON.stringify(new URL('../dist/adapters/repository.js', import.meta.url).href)};
    const input = ${JSON.stringify(input)};
    input.context = { root: input.root, mode: 'analyze', workspace: {}, invoke: async () => {}, command: async () => {}, authorizeTool: async () => {}, authorizeWrite: async () => {}, changed() {} };
    const repo = new Repository(input.directory);
    const opened = await openPi(input);
    const descriptor = await opened.session.checkpoint();
    repo.save('session', { id: 'session', projectId: 'project', title: 'first', pinned: false, archived: false, piPath: descriptor.path, transcript: descriptor });
    repo.save('run', { id: 'run', sessionId: 'session', status: 'running' });
    await opened.session.prompt('first prompt');
    process.stdout.write('materialized\n');
    await new Promise(() => setInterval(() => {}, 1000));
  `
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    })
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (bytes) => {
        if (String(bytes).includes('materialized')) resolve()
      })
      child.once('exit', () => reject(new Error('fixture exited before persistence')))
    })
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    const repo = new Repository(root),
      session = repo.get('session', 'session')
    assert.equal(repo.get('run', 'run').status, 'interrupted')
    assert.equal(session.transcript.state, 'allocated')
    const saved = await readFile(session.piPath, 'utf8')
    assert.ok(saved.includes('first prompt') && saved.includes('saved answer'))
    const opened = await openPi({
      ...input,
      transcript: session,
      context: {
        root,
        mode: 'analyze',
        workspace: {},
        invoke: async () => {},
        command: async () => {},
        authorizeTool: async () => {},
        authorizeWrite: async () => {},
        changed() {},
      },
    })
    const recovered = await opened.session.checkpoint()
    assert.equal(recovered.piSessionId, session.transcript.piSessionId)
    assert.equal(recovered.path, session.piPath)
    assert.equal(recovered.state, 'materialized')
    await opened.session.close()
    repo.close()
  },
)
