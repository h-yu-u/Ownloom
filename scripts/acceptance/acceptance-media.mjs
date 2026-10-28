import { randomUUID } from 'node:crypto'
import { crc32, inflateSync } from 'node:zlib'
import { eventFrames } from './acceptance-runtime.mjs'
import { digest, sleep } from './acceptance-system.mjs'

export function validatePng(bytes) {
  const content = Buffer.from(bytes)
  if (!content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw new Error('Invalid PNG signature')
  let offset = 8,
    width,
    height,
    channels,
    finished = false
  const compressed = []
  while (offset + 12 <= content.length) {
    const length = content.readUInt32BE(offset)
    const type = content.toString('ascii', offset + 4, offset + 8)
    const data = content.subarray(offset + 8, offset + 8 + length)
    if (offset + length + 12 > content.length) throw new Error('Truncated PNG chunk')
    if (
      crc32(content.subarray(offset + 4, offset + 8 + length)) !==
      content.readUInt32BE(offset + 8 + length)
    )
      throw new Error('PNG checksum mismatch')
    if (type === 'IHDR') {
      if (length !== 13 || width !== undefined) throw new Error('Invalid PNG header')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      channels = { 2: 3, 6: 4 }[data[9]]
      if (data[8] !== 8 || !channels || data[10] !== 0 || data[11] !== 0 || data[12] !== 0)
        throw new Error('Expected an 8-bit, non-interlaced RGB/RGBA PNG')
    }
    if (type === 'IDAT') compressed.push(data)
    if (type === 'IEND') {
      finished = true
      break
    }
    offset += length + 12
  }
  if (!finished || width !== 512 || height !== 512) throw new Error('Unexpected PNG dimensions')
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: 2 * 1024 * 1024 })
  const stride = 1 + width * channels
  if (pixels.length !== stride * height) throw new Error('PNG scanline length mismatch')
  for (let row = 0; row < height; row++)
    if (pixels[row * stride] > 4) throw new Error('Invalid PNG scanline filter')
  return { sha256: digest(content), width, height, bytes: content.length }
}

export function validateWav(bytes) {
  const content = Buffer.from(bytes)
  if (
    content.toString('ascii', 0, 4) !== 'RIFF' ||
    content.toString('ascii', 8, 12) !== 'WAVE' ||
    content.length < 44 ||
    content.readUInt32LE(4) + 8 !== content.length
  )
    throw new Error('Invalid WAV container')
  let format,
    channels,
    sampleRate,
    blockAlign,
    dataBytes = 0
  for (let offset = 12; offset + 8 <= content.length; ) {
    const size = content.readUInt32LE(offset + 4)
    if (offset + 8 + size > content.length) throw new Error('Truncated WAV chunk')
    const type = content.toString('ascii', offset, offset + 4)
    if (type === 'fmt ' && size >= 16) {
      format = content.readUInt16LE(offset + 8)
      channels = content.readUInt16LE(offset + 10)
      sampleRate = content.readUInt32LE(offset + 12)
      blockAlign = content.readUInt16LE(offset + 20)
    }
    if (type === 'data') dataBytes += size
    offset += 8 + size + (size % 2)
  }
  if (
    ![1, 3].includes(format) ||
    channels !== 1 ||
    sampleRate <= 0 ||
    !blockAlign ||
    !dataBytes ||
    dataBytes % blockAlign
  )
    throw new Error('Invalid generated WAV audio')
  return {
    sha256: digest(content),
    sampleRate,
    channels,
    frames: dataBytes / blockAlign,
    bytes: content.length,
  }
}

export async function chatTurn(runtime, conversation, model, cancel = false) {
  const info = await runtime.json('/runtime/info')
  const stream = await runtime.fetch(`/events?after=${info.event_sequence}`, { timeout: 600000 })
  try {
    const job = await runtime.json(`/conversations/${conversation}/messages`, {
      model_id: model,
      temperature: 0,
      max_tokens: cancel ? 2048 : 64,
      content: cancel ? '逐行写出从1到500的所有整数，不要省略。' : '用一句话介绍本地人工智能。',
      client_request_id: randomUUID(),
    })
    let text = '',
      deltas = 0,
      requested = false
    for await (const event of eventFrames(stream.body)) {
      if (event.payload?.job_id !== job.jobId) continue
      if (event.type === 'generation.delta') {
        if (requested) {
          // Deltas already in flight before cancellation acknowledgement are legal.
          continue
        }
        text += event.payload.text
        deltas++
        if (cancel) {
          await runtime.json(`/conversations/${conversation}/cancel?job_id=${job.jobId}`, {})
          requested = true
        }
      }
      if (['job.succeeded', 'job.cancelled', 'job.failed'].includes(event.type)) {
        if (event.type !== (cancel ? 'job.cancelled' : 'job.succeeded') || !deltas || !text.trim())
          throw new Error(`Chat terminal state invalid: ${event.type}`)
        const saved = await runtime.json(`/conversations/${conversation}`)
        if (!cancel && saved.messages.at(-1)?.content !== text)
          throw new Error('Streamed chat differs from persisted history')
        return { deltas, state: event.type, messages: saved.messages.length }
      }
    }
    throw new Error('Chat event stream ended before terminal state')
  } finally {
    // eventFrames releases its reader when breaking/returning from the iterator.
    if (!stream.body.locked) await stream.body.cancel()
  }
}

export async function pollJob(runtime, path, cancel = false) {
  const deadline = performance.now() + 600000
  let requested = false,
    progress = false
  while (performance.now() < deadline) {
    const job = await runtime.json(path)
    if (job.state === 'running') {
      progress ||= job.progress > 0
      if (cancel && !requested && (job.progress === undefined || progress)) {
        await runtime.json(path + '/cancel', {})
        requested = true
      }
    }
    if (['succeeded', 'failed', 'cancelled'].includes(job.state)) {
      if (
        job.state !== (cancel ? 'cancelled' : 'succeeded') ||
        job.simulated ||
        (cancel && (!requested || job.artifact_id))
      )
        throw new Error(`Unexpected task result: ${job.state} ${job.error_code ?? ''}`)
      return { ...job, sawProgress: progress }
    }
    await sleep(200)
  }
  throw new Error('Task terminal-state deadline exceeded')
}

export async function image(runtime, model, cancel = false) {
  const job = await runtime.json('/image-jobs', {
    model_id: model,
    client_request_id: randomUUID(),
    prompt: 'A red ceramic teapot on a wooden table, natural light.',
    width: 512,
    height: 512,
    steps: cancel ? 80 : 12,
    seed: 42,
  })
  const completed = await pollJob(runtime, '/image-jobs/' + job.id, cancel)
  if (!completed.sawProgress) throw new Error('Image progress was never observed')
  if (cancel) return { state: completed.state }
  const path = `/image-artifacts/${completed.artifact_id}/content`
  const bytes = Buffer.from(await (await runtime.fetch(path)).arrayBuffer())
  return { path, ...validatePng(bytes) }
}

export async function speech(runtime, parameters, cancel = false) {
  const job = await runtime.json('/audio-generations', {
    ...parameters,
    clientRequestId: randomUUID(),
    ...(cancel ? { text: '取消生成测试。'.repeat(100) } : {}),
  })
  const completed = await pollJob(runtime, '/audio-generations/' + job.id, cancel)
  if (cancel) return { state: completed.state }
  const path = `/audio-artifacts/${completed.artifact_id}/content`
  const bytes = Buffer.from(await (await runtime.fetch(path)).arrayBuffer())
  return { path, content: bytes, ...validateWav(bytes) }
}
