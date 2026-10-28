import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Repository } from '../dist/adapters/repository.js'
import { Runs } from '../dist/application/runs.js'
import { AgentChat } from '../dist/application/agent-chat.js'
import { RunAdmission } from '../dist/application/run-lifecycle.js'

const provider = {
  modelId: 'fake',
  baseUrl: 'http://127.0.0.1:1234/internal/v1/inference',
  token: 'isolated',
  fingerprint: 'fixture',
  contextWindow: 32768,
}
const submission = { sessionId: 's', text: 'task', mode: 'develop', provider }
const gate = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await delay(5)
  }
  assert.fail('Expected lifecycle state did not arrive')
}
async function fixture(t, close) {
  const directory = await mkdtemp('/tmp/ownloom-run-cleanup-')
  const repo = new Repository(directory)
  repo.save('project', { id: 'p', path: directory, commands: [], git: false })
  repo.save('session', { id: 's', projectId: 'p', archived: false, piPath: null })
  let opens = 0
  const ports = {
    commands: { run: async () => ({ exitCode: 0, output: '', truncated: false }), close() {} },
    fingerprint: async () => 'fixture',
    gitStatus: async () => '',
    workspace: () => ({ write: async () => '' }),
    open: async () => {
      opens++
      return {
        path: () => undefined,
        session: {
          prompt: async () => {},
          subscribe() {},
          close,
          abort: async () => {},
          steer: async () => {},
          lastStopReason: () => 'stop',
          lastErrorCode: () => undefined,
        },
      }
    },
  }
  const admission = new RunAdmission(),
    cleanup = []
  const runs = new Runs(repo, ports, admission)
  t.after(async () => {
    for (const action of cleanup) await action()
    await runs.close()
    repo.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { repo, runs, ports, admission, cleanup, opens: () => opens }
}

test('cleanup failure records a fault and closes queue admission without rejecting its task', async (t) => {
  const f = await fixture(t, async () => {
    throw new Error('CLOSE_FAILED')
  })
  let capabilityClosed = false
  f.ports.closeCapability = async () => {
    capabilityClosed = true
  }
  const first = await f.runs.submit({
    ...submission,
    submissionId: 'first',
    runtime: { bootstrapToken: 'fixture' },
  })
  const second = await f.runs.submit({ ...submission, submissionId: 'second', queue: true })
  await assert.doesNotReject(f.runs.wait(first.id))
  assert.equal(f.repo.get('run', first.id).status, 'interrupted')
  assert.equal(f.repo.get('run', first.id).error, 'CODING_CLEANUP_FAILED')
  assert.equal(f.repo.get('run', second.id).status, 'interrupted')
  assert.equal(f.opens(), 1)
  assert.equal(capabilityClosed, true)
  assert.equal(f.runs.busy, true)
  await assert.rejects(
    f.runs.submit({ ...submission, submissionId: 'third' }),
    /CODING_CLEANUP_FAILED/,
  )
})

test('terminal success waits for cleanup and cancellation during cleanup stays cancelled', async (t) => {
  const closing = gate(),
    started = gate()
  const f = await fixture(t, async () => {
    started.release()
    await closing.promise
  })
  f.cleanup.push(() => closing.release())
  const run = await f.runs.submit({ ...submission, submissionId: 'cleanup-cancel' })
  await started.promise
  assert.equal(f.repo.get('run', run.id).status, 'running')
  const cancelled = f.runs.cancel(run.id)
  closing.release()
  assert.equal((await cancelled).status, 'cancelled')
  assert.equal(f.runs.busy, false)
})

test('Agent cleanup faults retain ownership and block shared Coding admission', async (t) => {
  const f = await fixture(t, async () => {
    throw new Error('AGENT_CLOSE_FAILED')
  })
  f.repo.save('agentSession', { id: 'a', title: 'fixture', piPath: null })
  const agent = new AgentChat(
    {
      repo: f.repo,
      codingBusy: () => false,
      modelAllowed: () => true,
      extensions: {
        resolver: {
          resolve: () => ({ snapshot: { tools: [{}], skills: [], servers: [] } }),
          check() {},
        },
      },
      activate: async () => ({ token: 'fixture', capabilityUrl: 'http://127.0.0.1:1234' }),
      closeCapability: async () => {},
      open: f.ports.open,
    },
    f.admission,
  )
  f.cleanup.push(() => agent.close())
  const run = await agent.dispatch('agent.runs.prepare', {
    sessionId: 'a',
    submissionId: 'agent',
    text: 'task',
    provider,
  })
  await agent.dispatch('agent.runs.commit', {
    id: run.id,
    bootstrapToken: 'fixture',
    capabilityUrl: 'http://127.0.0.1:1234',
  })
  await until(() => f.repo.get('run', run.id).status === 'interrupted')
  assert.equal(agent.busy, true)
  assert.equal(f.repo.get('run', run.id).error, 'CODING_CLEANUP_FAILED')
  await assert.rejects(
    f.runs.submit({ ...submission, submissionId: 'after-agent-fault' }),
    /CODING_CLEANUP_FAILED/,
  )
})

test('an outstanding abort must settle before ownership can pass to the next run', async (t) => {
  const prompt = gate(),
    aborting = gate()
  const f = await fixture(t, async () => {})
  f.cleanup.push(() => {
    prompt.release()
    aborting.release()
  })
  const open = f.ports.open
  f.ports.open = async () => {
    const opened = await open()
    opened.session.prompt = () => prompt.promise
    opened.session.abort = async () => {
      await aborting.promise
      throw new Error('ABORT_FAILED')
    }
    return opened
  }
  const first = await f.runs.submit({ ...submission, submissionId: 'abort-first' })
  const second = await f.runs.submit({ ...submission, submissionId: 'abort-second', queue: true })
  await until(() => f.repo.get('run', first.id).status === 'running')
  const cancelled = f.runs.cancel(first.id)
  prompt.release()
  await delay(5)
  assert.equal(f.repo.get('run', first.id).status, 'cancelling')
  assert.equal(f.opens(), 1)
  aborting.release()
  assert.equal((await cancelled).status, 'interrupted')
  assert.equal(f.repo.get('run', second.id).status, 'interrupted')
  assert.equal(f.opens(), 1)
})
