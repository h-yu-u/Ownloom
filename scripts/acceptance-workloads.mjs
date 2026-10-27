import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { digest } from './acceptance-system.mjs'
import { chatTurn, image, speech } from './acceptance-media.mjs'

export async function coldStart(runtime) {
  const info = await runtime.json('/runtime/info')
  if (info.protocol_version !== 1 || info.pid !== runtime.runtimePid)
    throw new Error('Runtime protocol/PID mismatch')
  if ((await runtime.json('/models')).length !== 0)
    throw new Error('Isolated fresh database unexpectedly contains models')
  const denied = await fetch(runtime.base + '/models', { signal: AbortSignal.timeout(10000) })
  if (![401, 403].includes(denied.status)) throw new Error('Unauthenticated API access accepted')
  await denied.body?.cancel()
  const projectPath = join(runtime.root, 'work', '项目 with spaces')
  await mkdir(projectPath)
  const project = await runtime.json('/coding/projects', { path: projectPath })
  const session = await runtime.json(`/coding/projects/${project.id}/sessions`, {
    title: '隔离验收',
  })
  const snapshot = await runtime.json(`/coding/sessions/${session.id}/snapshot`)
  if (snapshot.runs.length !== 0) throw new Error('Unexpected fresh Coding history')
  return {
    status: 'passed',
    authentication: 'passed',
    emptyModelCatalog: 'passed',
    packagedNodeHost: 'passed',
    project: project.id,
    session: session.id,
  }
}

export async function importModels(runtime, paths) {
  const models = {}
  const engines = { text: 'mlx-vlm', image: 'mflux', preset: 'mlx-audio', clone: 'mlx-audio' }
  for (const [kind, path] of Object.entries(paths)) {
    const model = await runtime.json('/models/import', { path })
    if (model.engine !== engines[kind])
      throw new Error(`Unexpected ${kind} engine: ${model.engine}`)
    models[kind] = model
  }
  if (
    !models.preset.speech?.operations.some((op) => op.mode === 'preset') ||
    !models.clone.speech?.operations.some((op) => op.mode === 'clone')
  )
    throw new Error('Speech models lack required modes')
  return models
}

async function historyCount(runtime, path) {
  let count = 0,
    batch
  do {
    batch = await runtime.json(`${path}?limit=60&offset=${count}`)
    count += batch.length
  } while (batch.length === 60)
  return count
}

export async function cycle(runtime, state, phase) {
  const results = {},
    models = state.models
  await phase('chat, cancellation and recovery')
  const conversation = await runtime.json('/conversations', {
    title: '隔离稳定性验收',
    model_id: models.text.id,
  })
  results.chat = await chatTurn(runtime, conversation.id, models.text.id)
  results.chatCancellation = await chatTurn(runtime, conversation.id, models.text.id, true)
  results.chatRecovery = await chatTurn(runtime, conversation.id, models.text.id)
  state.conversation = { id: conversation.id, messages: results.chatRecovery.messages }

  await phase('image cancellation and recovery')
  const imagesBefore = await historyCount(runtime, '/image-artifacts')
  results.imageCancellation = await image(runtime, models.image.id, true)
  if ((await historyCount(runtime, '/image-artifacts')) !== imagesBefore)
    throw new Error('Cancelled image created an artifact')
  const generatedImage = await image(runtime, models.image.id)
  if ((await historyCount(runtime, '/image-artifacts')) !== imagesBefore + 1)
    throw new Error('Image history count mismatch')
  results.image = generatedImage
  state.witnesses.push(generatedImage)

  await phase('preset speech and generated reference voice')
  const audiosBefore = await historyCount(runtime, '/audio-artifacts')
  const preset = await speech(runtime, {
    modelId: models.preset.id,
    mode: 'preset',
    language: 'zh',
    text: '你好，这是本地语音合成验证。',
    speaker: models.preset.speech.operations.find((op) => op.mode === 'preset').presetSpeakers[0],
  })
  const { content, ...presetEvidence } = preset
  results.preset = presetEvidence
  state.witnesses.push(presetEvidence)
  if (!state.voice) {
    const asset = await (
      await runtime.fetch('/audio-assets?filename=generated-reference.wav', {
        method: 'POST',
        body: content,
        headers: { 'Content-Type': 'audio/wav' },
      })
    ).json()
    state.voice = (
      await runtime.json('/voices', {
        name: '生成样本验收音色',
        reference_asset_id: asset.id,
        reference_text: '你好，这是本地语音合成验证。',
        language: 'zh',
        source: 'generated',
        consent: true,
      })
    ).id
  }

  await phase('clone speech cancellation and recovery')
  const parameters = {
    modelId: models.clone.id,
    mode: 'clone',
    voiceId: state.voice,
    text: '语音工作室可以在本地复用参考声音。',
    language: 'zh',
  }
  const { content: _cloneContent, ...clone } = await speech(runtime, parameters)
  results.clone = clone
  state.witnesses.push(clone)
  results.speechCancellation = await speech(runtime, parameters, true)
  if ((await historyCount(runtime, '/audio-artifacts')) !== audiosBefore + 2)
    throw new Error('Cancelled speech changed artifact history')
  const { content: _recoveryContent, ...recovery } = await speech(runtime, parameters)
  results.speechRecovery = recovery
  state.witnesses.push(recovery)
  if ((await historyCount(runtime, '/audio-artifacts')) !== audiosBefore + 3)
    throw new Error('Speech history count mismatch')

  await phase('real Coding tool/command loop')
  const capability = await runtime.json(
    `/coding/capabilities/${models.text.id}/verify`,
    {},
    { timeout: 1300000 },
  )
  if (capability.status !== 'verified') throw new Error('Real Coding tool loop did not verify')
  results.coding = { status: capability.status, parserVersion: capability.parserVersion }
  await phase('unloading and resource checkpoint')
  await runtime.json(`/models/${models.text.id}/unload`, {})
  return results
}

export async function persistence(runtime, state) {
  const snapshot = await runtime.json(`/coding/sessions/${state.cold.session}/snapshot`)
  if (snapshot.runs.length !== 0) throw new Error('Coding history changed after restart')
  if (state.conversation) {
    const conversation = await runtime.json(`/conversations/${state.conversation.id}`)
    if (conversation.messages.length !== state.conversation.messages)
      throw new Error('Chat history changed after restart')
  }
  const witnesses =
    state.witnesses.length <= 8
      ? state.witnesses
      : [...state.witnesses.slice(0, 4), ...state.witnesses.slice(-4)]
  for (const witness of witnesses) {
    const bytes = Buffer.from(await (await runtime.fetch(witness.path)).arrayBuffer())
    if (digest(bytes) !== witness.sha256) throw new Error('Persisted media changed after restart')
  }
  if (state.voice && !(await runtime.json('/voices')).some((voice) => voice.id === state.voice))
    throw new Error('Voice profile lost after restart')
  return {
    status: 'passed',
    mediaHashesChecked: witnesses.length,
    chat: !!state.conversation,
    codingSession: true,
    voice: !!state.voice,
  }
}
