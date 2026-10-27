import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { chmod, mkdir, readFile, unlink, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dbPath, projectFixture } from './acceptance-data-fixtures.mjs'
import { fakeImage, fakeSpeech, waitJob } from './acceptance-packaged-checks.mjs'
import { command, processTable, sameProcess, sleep } from './acceptance-system.mjs'

async function pending(runtime, session, run) {
  const deadline = performance.now() + 30000
  while (performance.now() < deadline) {
    const state = await runtime.json(`/coding/sessions/${session}/snapshot`)
    const approval = state.approvals.find((a) => a.runId === run && a.status === 'pending')
    if (approval) return approval
    assert.ok(
      !state.runs.some(
        (r) => r.id === run && ['failed', 'completed', 'cancelled'].includes(r.status),
      ),
    )
    await sleep(20)
  }
  throw new Error('Expected command approval not reached')
}

async function stopHost(runtime) {
  const host = (await runtime.capture()).find(
    (row) => row.parent === runtime.runtimePid && row.command.endsWith('/bin/node'),
  )
  assert.ok(host, 'Expected the actual packaged Node Host')
  process.kill(host.pid, 'SIGKILL')
  await sleep(100)
}

async function recovered(runtime, fixture, run, approval) {
  const state = await runtime.json(`/coding/sessions/${fixture.session.id}/snapshot`)
  assert.equal(state.runs.find((r) => r.id === run.id).status, 'interrupted')
  assert.equal(
    state.approvals.find((a) => a.id === approval.id).status,
    approval.status === 'pending' ? 'denied' : 'allowed',
  )
  assert.equal(state.activeRun, null)
  const before = state.events.filter((e) => e.type === 'tool.started' && e.runId === run.id).length
  await sleep(150)
  const again = await runtime.json(`/coding/sessions/${fixture.session.id}/snapshot`)
  assert.equal(
    again.events.filter((e) => e.type === 'tool.started' && e.runId === run.id).length,
    before,
  )
  return {
    runStatus: 'interrupted',
    approvalStatus: state.approvals.find((a) => a.id === approval.id).status,
    toolCallsBeforeAndAfter: [before, before],
    automaticReplay: false,
  }
}

export async function faults(context) {
  let runtime = context.current
  const result = {}
  let db = new DatabaseSync(dbPath(context.root))
  try {
    db.exec(
      "CREATE TRIGGER qa_fail_image BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT,'QA_STORAGE_FAILURE'); END;",
    )
    const failed = await fakeImage(runtime)
    assert.equal(failed.state, 'failed')
    assert.equal((await runtime.json('/image-artifacts')).length, 0)
    db.exec('DROP TRIGGER qa_fail_image')
    assert.equal((await fakeImage(runtime)).state, 'succeeded')
    db.exec(
      "CREATE TRIGGER qa_fail_audio BEFORE INSERT ON audio_artifacts BEGIN SELECT RAISE(ABORT,'QA_STORAGE_FAILURE'); END;",
    )
    assert.equal((await fakeSpeech(runtime)).state, 'failed')
    assert.equal((await runtime.json('/audio-artifacts')).length, 0)
    db.exec('DROP TRIGGER qa_fail_audio')
    assert.equal((await fakeSpeech(runtime)).state, 'succeeded')
    result.storageTransactions = {
      image: 'failure, no artifact, recovery passed',
      audio: 'failure, no artifact, recovery passed',
    }
  } finally {
    db.close()
  }
  const staging = join(context.root, 'media/audio/staging')
  await mkdir(staging, { recursive: true })
  await chmod(staging, 0o500)
  try {
    assert.equal((await fakeSpeech(runtime)).state, 'failed')
  } finally {
    await chmod(staging, 0o700)
  }
  assert.equal((await fakeSpeech(runtime)).state, 'succeeded')
  result.writePermissionRecovery = 'passed'
  result.audioStagingFiles = await readdir(staging)
  assert.deepEqual(result.audioStagingFiles, [])

  await runtime.json('/coding/capabilities/builtin-fake-text/verify', {}, { timeout: 60000 })
  const fixture = await projectFixture(runtime)
  const submit = () =>
    runtime.json(`/coding/sessions/${fixture.session.id}/runs`, {
      submissionId: randomUUID(),
      text: 'Coding capability probe: exercise only the fixed probe tools.',
      modelId: 'builtin-fake-text',
      mode: 'develop',
    })
  const first = await submit(),
    approval = await pending(runtime, fixture.session.id, first.id)
  await stopHost(runtime)
  result.pendingHostCrash = await recovered(runtime, fixture, first, approval)
  const stale = await fetch(runtime.base + `/coding/approvals/${approval.id}/resolve`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + runtime.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed: true }),
    signal: AbortSignal.timeout(10000),
  })
  assert.ok(stale.status >= 400)
  await stale.body?.cancel()
  result.staleApprovalRejected = true

  await writeFile(join(fixture.directory, 'probe.txt'), 'before\n')
  const second = await submit(),
    secondApproval = await pending(runtime, fixture.session.id, second.id)
  assert.equal(secondApproval.command, "/usr/bin/grep -qx 'after' probe.txt")
  const previous = await readFile(join(fixture.directory, 'probe.txt'))
  await unlink(join(fixture.directory, 'probe.txt'))
  await command('/usr/bin/mkfifo', [join(fixture.directory, 'probe.txt')])
  let owned = []
  try {
    await runtime.json(`/coding/approvals/${secondApproval.id}/resolve`, { allowed: true })
    const deadline = performance.now() + 10000
    while (performance.now() < deadline) {
      owned = (await runtime.capture()).filter(
        (row) => row.command.endsWith('/grep') || row.command === '/bin/sh',
      )
      if (owned.some((row) => row.command.endsWith('/grep'))) break
      await sleep(20)
    }
    assert.ok(
      owned.some((row) => row.command.endsWith('/grep')),
      'Expected blocked approved grep child',
    )
    await stopHost(runtime)
    const end = performance.now() + 10000
    while (performance.now() < end) {
      const table = await processTable()
      if (!table.some((row) => owned.some((old) => sameProcess(row, old)))) break
      await sleep(50)
    }
    const table = await processTable()
    assert.equal(table.filter((row) => owned.some((old) => sameProcess(row, old))).length, 0)
  } finally {
    await unlink(join(fixture.directory, 'probe.txt'))
    await writeFile(join(fixture.directory, 'probe.txt'), previous)
  }
  result.activeCommandHostCrash = await recovered(runtime, fixture, second, {
    ...secondApproval,
    status: 'allowed',
  })
  result.commandProcessGroupCleaned = true

  const job = await runtime.json('/audio-generations', {
    modelId: 'builtin-fake-audio',
    mode: 'preset',
    speaker: 'demo',
    language: 'zh',
    text: 'interrupt fake tone',
    clientRequestId: randomUUID(),
  })
  await waitJob(runtime, '/audio-generations/' + job.id, ['running'])
  await runtime.capture()
  process.kill(runtime.runtimePid, 'SIGKILL')
  await context.stop(true)
  runtime = await context.start()
  const restored = await runtime.json('/audio-generations/' + job.id)
  assert.equal(restored.state, 'failed')
  assert.equal((await fakeSpeech(runtime)).state, 'succeeded')
  result.runtimeCrash = {
    inFlightStateOnRestart: restored.state,
    errorCode: restored.error_code,
    subsequentJob: 'succeeded',
    automaticReplay: false,
  }
  return { status: 'passed', ...result }
}
