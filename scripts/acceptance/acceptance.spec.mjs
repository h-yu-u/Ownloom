import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateSync } from 'node:zlib'
import {
  isolatedEnvironment,
  parseProcesses,
  processTree,
  sameProcess,
  assessResources,
} from './acceptance-system.mjs'
import { bounded, eventFrames } from './acceptance-runtime.mjs'
import { validatePng, validateWav } from './acceptance-media.mjs'
import { options } from './verify-bundle-stability.mjs'

test('isolated child environment does not inherit developer paths or credentials', () => {
  const before = process.env.TEST_ACCEPTANCE_SECRET
  process.env.TEST_ACCEPTANCE_SECRET = 'must-not-propagate'
  try {
    const env = isolatedEnvironment('/tmp/隔离 space', '/frozen/host', 'ephemeral')
    assert.equal(env.TEST_ACCEPTANCE_SECRET, undefined)
    assert.equal(env.PYTHONPATH, '')
    assert.equal(env.PYTHONNOUSERSITE, '1')
    assert.equal(env.HOME, '/tmp/隔离 space/home')
    assert.equal(env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin')
    assert.equal(env.HF_HUB_OFFLINE, '1')
    assert.equal(env.TRANSFORMERS_OFFLINE, '1')
    assert.equal(env.MLX_STUDIO_PARENT_PIPE, '1')
  } finally {
    if (before === undefined) delete process.env.TEST_ACCEPTANCE_SECRET
    else process.env.TEST_ACCEPTANCE_SECRET = before
  }
})

test('process inventory handles paths with spaces and follows only owned descendants', () => {
  const rows = parseProcesses(
    [
      '  20 1 1024 S Sat Oct 17 08:00:00 2026 /tmp/Ownloom.app/runtime',
      '  21 20 2048 S Sat Oct 17 08:00:01 2026 /tmp/Ownloom.app/worker',
      '  22 21 256 S Sat Oct 17 08:00:02 2026 /tmp/resource_tracker',
      '  30 1 2048 S Sat Oct 17 08:00:00 2026 /Applications/Ownloom.app/runtime',
    ].join('\n'),
  )
  assert.deepEqual(
    processTree(rows, 20).map((row) => row.pid),
    [20, 21, 22],
  )
  assert.equal(rows[0].rssBytes, 1024 * 1024)
  assert.equal(rows[0].command, '/tmp/Ownloom.app/runtime')
  assert.equal(sameProcess(rows[0], { ...rows[0], started: 'different birth time' }), false)
})

test('resource gate ignores warmup and detects continued unloaded process/FD/memory growth', () => {
  const samples = Array.from({ length: 10 }, (_, index) => ({
    rssBytes: index < 2 ? 8e9 : 100e6,
    descriptors: 40,
    processes: 3,
  }))
  assert.equal(assessResources(samples).status, 'within_proposed_limits')
  assert.equal(assessResources(samples.slice(0, 4)).status, 'insufficient_samples')
  for (const field of ['rssBytes', 'descriptors', 'processes']) {
    const leaking = samples.map((sample, index) => ({
      ...sample,
      [field]:
        sample[field] +
        (index >= 7 ? { rssBytes: 300e6, descriptors: 20, processes: 1 }[field] : 0),
    }))
    assert.equal(assessResources(leaking).status, 'resource_growth_requires_review')
  }
})

test('SSE decoding tolerates chunked UTF-8, comments and multiple data lines', async () => {
  const encoded = Buffer.from(': heartbeat\r\n\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\n')
  async function* fragments() {
    for (let index = 0; index < encoded.length; index++) yield encoded.subarray(index, index + 1)
  }
  const frames = []
  for await (const frame of eventFrames(fragments())) frames.push(frame)
  assert.deepEqual(frames, [{ text: '你好' }])
})

test('watchdog rejects an operation that never settles', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 5, 'deadline'), /deadline/)
})

function png() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(512, 0)
  header.writeUInt32BE(512, 4)
  header[8] = 8
  header[9] = 2
  const chunk = (type, bytes) => {
    const result = Buffer.alloc(bytes.length + 12)
    result.writeUInt32BE(bytes.length)
    result.write(type, 4)
    bytes.copy(result, 8)
    result.writeUInt32BE(crc32(result.subarray(4, 8 + bytes.length)), 8 + bytes.length)
    return result
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(512 * (1 + 512 * 3)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('PNG validation decompresses full scanlines and rejects truncated images', () => {
  const bytes = png()
  assert.equal(validatePng(bytes).width, 512)
  assert.throws(() => validatePng(bytes.subarray(0, bytes.length - 3)), /dimensions/)
  const invalid = Buffer.from(bytes)
  invalid.writeUInt32BE(128, 16)
  assert.throws(() => validatePng(invalid), /checksum/)
})

function wav() {
  const bytes = Buffer.alloc(48)
  bytes.write('RIFF')
  bytes.writeUInt32LE(40, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24)
  bytes.writeUInt32LE(48000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(4, 40)
  return bytes
}

test('WAV validation checks audio chunks and actual frame count', () => {
  const bytes = wav()
  assert.equal(validateWav(bytes).frames, 2)
  assert.equal(validateWav(bytes).sampleRate, 24000)
  assert.throws(() => validateWav(bytes.subarray(0, 46)), /container/)
  const invalid = Buffer.from(bytes)
  invalid.writeUInt32LE(20, 40)
  assert.throws(() => validateWav(invalid), /Truncated/)
})

test('smoke acceptance cannot silently masquerade as real-model soak', () => {
  const base = ['--app', '/tmp/app', '--output', '/tmp/new']
  assert.throws(() => options(base), /all four models/)
  assert.throws(() => options([...base, '--profile', 'smoke', '--text-model', '/model']), /smoke/)
  assert.throws(
    () => options([...base, '--profile', 'smoke', '--duration-seconds', 'NaN']),
    /valid/,
  )
  assert.throws(() => options([...base, '--profile', 'smoke', '--cycles', '0']), /valid/)
  assert.equal(options([...base, '--profile', 'smoke', '--duration-seconds', '0']).duration, 0)
})
