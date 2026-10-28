import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { chatTurn } from './acceptance-media.mjs'
import { digest, sleep } from './acceptance-system.mjs'
import {
  projectFixture,
  legacyFormat,
  databaseChecks,
  seedBulk,
  queryPlans,
} from './acceptance-data-fixtures.mjs'

export async function waitJob(runtime, path, states = ['succeeded', 'failed', 'cancelled']) {
  const deadline = performance.now() + 30000
  while (performance.now() < deadline) {
    const job = await runtime.json(path)
    if (states.includes(job.state)) return job
    await sleep(10)
  }
  throw new Error('Fake acceptance job did not converge')
}

export async function fakeImage(runtime) {
  const job = await runtime.json('/image-jobs', {
    model_id: 'builtin-fake-image',
    prompt: 'QA synthetic image',
    client_request_id: randomUUID(),
    width: 512,
    height: 512,
    steps: 8,
    seed: 7,
  })
  return waitJob(runtime, '/image-jobs/' + job.id)
}

export async function fakeSpeech(runtime) {
  const job = await runtime.json('/audio-generations', {
    modelId: 'builtin-fake-audio',
    mode: 'preset',
    speaker: 'demo',
    language: 'zh',
    text: 'QA synthetic tone fixture',
    clientRequestId: randomUUID(),
  })
  return waitJob(runtime, '/audio-generations/' + job.id)
}

export async function migration(context) {
  let runtime = context.current
  const fixture = await projectFixture(runtime)
  const conversation = await runtime.json('/conversations', {
    title: '旧聊天',
    model_id: 'builtin-fake-text',
  })
  await chatTurn(runtime, conversation.id, 'builtin-fake-text')
  const messageCount = (await runtime.json('/conversations/' + conversation.id)).messages.length
  const image = await fakeImage(runtime),
    audio = await fakeSpeech(runtime)
  assert.equal(image.state, 'succeeded')
  assert.equal(audio.state, 'succeeded')
  const imagePath = `/image-artifacts/${image.artifact_id}/content`
  const audioPath = `/audio-artifacts/${audio.artifact_id}/content`
  const bytes = Buffer.from(await (await runtime.fetch(audioPath)).arrayBuffer())
  const asset = await (
    await runtime.fetch('/audio-assets?filename=legacy-reference.wav', {
      method: 'POST',
      body: bytes,
    })
  ).json()
  const voice = await runtime.json('/voices', {
    name: '旧音色',
    reference_asset_id: asset.id,
    reference_text: 'Synthetic tone acceptance fixture',
    language: 'zh',
    source: 'generated',
    consent: true,
  })
  const witnesses = []
  for (const path of [imagePath, audioPath])
    witnesses.push({
      path,
      sha256: digest(Buffer.from(await (await runtime.fetch(path)).arrayBuffer())),
    })
  await context.stop()
  const modelDirectory = join(context.root, 'work', 'legacy-model')
  await mkdir(modelDirectory)
  const modelBytes = Buffer.from('Synthetic legacy model-file retention witness')
  const modelFile = join(modelDirectory, 'weights.safetensors')
  await writeFile(modelFile, modelBytes)
  const db = new DatabaseSync(join(context.root, 'data/app.db'))
  db.prepare(
    "UPDATE models SET manifest_json=json_set(manifest_json,'$.localPath',?) WHERE id='builtin-fake-text'",
  ).run(modelDirectory)
  db.close()
  legacyFormat(context.root, fixture)
  const before = {
    runtime: 'legacy messages without turn_id and migrations 2/6; existing v5 audio tables',
    codingVersion: 0,
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    runtime = await context.start()
    assert.equal(
      (await runtime.json('/models')).some((m) => m.id === 'legacy-builtin-demo'),
      false,
    )
    assert.equal((await runtime.json('/models')).length, 3)
    assert.equal(
      (await runtime.json('/models')).find((m) => m.id === 'builtin-fake-text').localPath,
      modelDirectory,
    )
    assert.equal(digest(await readFile(modelFile)), digest(modelBytes))
    assert.equal(
      (await runtime.json('/conversations/' + conversation.id)).messages.length,
      messageCount,
    )
    assert.ok((await runtime.json('/voices')).some((v) => v.id === voice.id))
    for (const witness of witnesses)
      assert.equal(
        digest(Buffer.from(await (await runtime.fetch(witness.path)).arrayBuffer())),
        witness.sha256,
      )
    const state = await runtime.json(`/coding/sessions/${fixture.session.id}/snapshot`)
    assert.equal(state.runs.find((r) => r.id === 'legacy-pending-run').status, 'interrupted')
    assert.equal(state.approvals.find((a) => a.id === 'legacy-pending-approval').status, 'denied')
    assert.equal(await readFile(join(fixture.directory, 'probe.txt'), 'utf8'), 'before\n')
    await context.stop()
  }
  const checks = databaseChecks(context.root)
  assert.equal(Object.values(checks.runtimeIntegrity)[0], 'ok')
  assert.equal(Object.values(checks.codingIntegrity)[0], 'ok')
  assert.deepEqual(checks.foreignKeys, [])
  assert.equal(checks.codingVersion, 1)
  assert.deepEqual(
    checks.migrations.map((v) => v.version),
    [1, 2, 3, 4, 5, 6],
  )
  return {
    status: 'passed',
    fixture: 'synthetic supported legacy formats; not private user data',
    before,
    startupPasses: 2,
    retained: [
      'model registrations',
      'referenced synthetic model-file bytes',
      'chat/messages',
      'image bytes',
      'audio bytes',
      'voice',
      'Coding session',
    ],
    pendingApprovalDenied: true,
    oldCommandNotReplayed: true,
    checks,
  }
}

export async function history(context) {
  let runtime = context.current
  const fixture = await projectFixture(runtime)
  await context.stop()
  const dataset = seedBulk(context.root, fixture)
  runtime = await context.start()
  const durations = []
  let cursor = '',
    seen = new Set()
  do {
    const started = performance.now()
    const page = await runtime.json(
      `/coding/projects/${fixture.project.id}/sessions?limit=500${cursor ? '&before=' + cursor : ''}`,
    )
    durations.push(performance.now() - started)
    for (const item of page) {
      assert.equal(item.projectId, fixture.project.id)
      assert.equal(seen.has(item.id), false)
      seen.add(item.id)
    }
    cursor = page.length === 500 ? page.at(-1).id : ''
  } while (cursor)
  assert.equal(seen.size, 10001)
  const started = performance.now()
  const snapshot = await runtime.json(`/coding/sessions/${fixture.session.id}/snapshot`)
  const snapshotMilliseconds = performance.now() - started
  assert.equal(snapshot.runs.length, 50)
  assert.equal(snapshot.events.length, 100)
  assert.equal(snapshot.events.at(-1).seq, 2000)
  assert.equal(snapshot.watermark, 102000)
  const response = await runtime.fetch(`/coding/sessions/${fixture.session.id}/changes`)
  const encoded = await response.text(),
    changes = JSON.parse(encoded)
  const headers = changes.managed
  assert.equal(headers.length, 100)
  assert.equal(encoded.includes('QA_LARGE_FILE_BODY_MUST_LOAD_ON_DEMAND'), false)
  const detail = await runtime.json('/coding/changes/' + headers[0].id)
  assert.equal(detail.contentLoaded, true)
  assert.ok(detail.after.includes('QA_LARGE_FILE_BODY_MUST_LOAD_ON_DEMAND'))
  const plans = queryPlans(context.root, fixture)
  assert.ok(plans.sessions.some((p) => p.detail.includes('entities_project')))
  assert.ok(plans.events.some((p) => p.detail.includes('events_session_seq')))
  const sorted = [...durations].sort((a, b) => a - b)
  return {
    status: 'passed',
    dataset,
    paginatedSessions: seen.size,
    pages: durations.length,
    sessionPageP95Milliseconds: sorted[Math.floor(sorted.length * 0.95)],
    snapshotMilliseconds,
    snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    changeHeaderBytes: Buffer.byteLength(encoded),
    changeDetailBytes: Buffer.byteLength(detail.after),
    boundedSnapshot: { runs: 50, events: 100, changeHeaders: 100 },
    plans,
    browserInteraction: 'separate UI acceptance required',
  }
}

export async function privacy(context) {
  const runtime = context.current
  const marker = 'QA_PRIVATE_' + randomUUID()
  const fixture = await projectFixture(runtime, marker)
  const conversation = await runtime.json('/conversations', {
    title: marker,
    model_id: 'builtin-fake-text',
  })
  const sent = await runtime.json(`/conversations/${conversation.id}/messages`, {
    content: marker,
    model_id: 'builtin-fake-text',
    max_tokens: 32,
  })
  await waitJob(runtime, '/jobs/' + sent.jobId)
  const errors = []
  for (const [path, method, body] of [
    ['/conversations', 'POST', { title: { private: marker } }],
    ['/models/import', 'POST', { path: '/nonexistent/' + marker }],
    [`/coding/sessions/${fixture.session.id}/file?path=../../${marker}`, 'GET', undefined],
  ]) {
    const result = await fetch(runtime.base + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + runtime.token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await result.text()
    assert.ok(result.status >= 400)
    assert.equal(text.includes(marker), false)
    assert.equal(text.includes(runtime.token), false)
    errors.push({ status: result.status, code: JSON.parse(text).error?.code })
  }
  for (const content of ['<svg onload="alert(1)">' + marker + '</svg>', marker]) {
    const rejected = await fetch(runtime.base + '/attachments?filename=' + marker + '.png', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + runtime.token, 'Content-Type': 'image/png' },
      body: content,
      signal: AbortSignal.timeout(10000),
    })
    const body = await rejected.text()
    assert.ok([400, 413, 415, 422].includes(rejected.status))
    assert.equal(body.includes(marker), false)
    assert.equal(rejected.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(rejected.headers.get('Cache-Control'), 'no-store')
    errors.push({ status: rejected.status, code: JSON.parse(body).error?.code })
  }
  const image = await fakeImage(runtime)
  const png = Buffer.from(
    await (await runtime.fetch(`/image-artifacts/${image.artifact_id}/content`)).arrayBuffer(),
  )
  const accepted = await (
    await runtime.fetch('/attachments?filename=' + marker + '.png', { method: 'POST', body: png })
  ).json()
  assert.ok(accepted.id)
  const archive = Buffer.from(
    await (await runtime.fetch('/runtime/diagnostics/bundle')).arrayBuffer(),
  )
  const path = join(context.output, 'diagnostics.zip')
  await writeFile(path, archive, { mode: 0o600 })
  const code =
    'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))'
  const { stdout } = await promisify(execFile)(context.python, ['-c', code, path])
  assert.equal(stdout.includes(marker), false)
  assert.equal(stdout.includes(runtime.token), false)
  assert.equal(stdout.includes(fixture.directory), false)
  assert.equal(stdout.includes('probe.txt'), false)
  await context.stop()
  const logs = await readFile(join(context.output, 'runtime.stderr.log'), 'utf8')
  assert.equal(logs.includes(marker), false)
  assert.equal(logs.includes(runtime.token), false)
  return {
    status: 'passed',
    syntheticPrivateInputs: true,
    errorResponses: errors,
    diagnosticEntries: Object.keys(JSON.parse(stdout)),
    archiveSha256: digest(archive),
    diagnosticCanariesAbsent: true,
    stderrCanariesAbsent: true,
    attachmentValidation:
      'valid PNG accepted; disguised SVG and invalid image rejected without echo',
    markdown: 'separate adversarial content/UI checks',
  }
}
