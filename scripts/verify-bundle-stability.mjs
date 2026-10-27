import { parseArgs } from 'node:util'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  command,
  fingerprint,
  systemInfo,
  saveJson,
  prepareDirectories,
  directoryUsage,
  assessResources,
} from './acceptance-system.mjs'
import { PackagedRuntime } from './acceptance-runtime.mjs'
import { coldStart, importModels, cycle, persistence } from './acceptance-workloads.mjs'
import { chatTurn } from './acceptance-media.mjs'

export function options(arguments_) {
  const { values } = parseArgs({
    args: arguments_,
    options: {
      app: { type: 'string' },
      output: { type: 'string' },
      profile: { type: 'string', default: 'real' },
      'duration-seconds': { type: 'string', default: '28800' },
      cycles: { type: 'string', default: '8' },
      'text-model': { type: 'string' },
      'image-model': { type: 'string' },
      'preset-model': { type: 'string' },
      'clone-model': { type: 'string' },
    },
  })
  const duration = Number(values['duration-seconds']),
    cycles = Number(values.cycles)
  if (
    !values.app ||
    !values.output ||
    !['smoke', 'real'].includes(values.profile) ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > 604800 ||
    !Number.isInteger(cycles) ||
    cycles < 1 ||
    cycles > 10000
  )
    throw new Error('Require --app, a new --output directory, valid --profile/duration/cycles')
  const paths = Object.fromEntries(
    ['text', 'image', 'preset', 'clone']
      .filter((key) => values[key + '-model'])
      .map((key) => [key, resolve(values[key + '-model'])]),
  )
  if (
    (values.profile === 'real' && Object.keys(paths).length !== 4) ||
    (values.profile === 'smoke' && Object.keys(paths).length)
  )
    throw new Error('Real profile requires all four models; smoke profile accepts no models')
  return {
    app: resolve(values.app),
    output: resolve(values.output),
    profile: values.profile,
    duration,
    cycles,
    paths,
  }
}

export async function verify(plan) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Acceptance requires an Apple Silicon Mac')
  // A new output folder prevents accidentally sharing or overwriting a user database.
  await mkdir(plan.output, { recursive: false, mode: 0o700 })
  const reportPath = join(plan.output, 'report.json')
  const root = join(plan.output, '隔离 workspace')
  const app = join(plan.output, 'artifact', 'Ownloom.app')
  const report = {
    status: 'running',
    startedAt: new Date().toISOString(),
    pid: process.pid,
    profile: plan.profile,
    requestedSeconds: plan.duration,
    minimumCycles: plan.cycles,
    cycles: [],
    checkpoints: [],
    shutdowns: [],
    persistence: [],
    warnings: 0,
    isolation: {
      freshHomeAndData: true,
      systemOnlyPath: true,
      sourcePythonPath: false,
      packagedRuntimeAndNode: true,
      offlineModelFlags: true,
      boundary:
        'Same host/user, not an OS sandbox or clean machine; network is not disabled by the harness.',
    },
    unverified: [
      'independent clean Mac',
      'native GUI/Gatekeeper installation',
      'sleep/wake and system-wide offline operation',
      'Developer ID/notarization',
    ],
  }
  let runtime, samples, started, original, copied
  const cancellation = new AbortController()
  const interrupted = () => cancellation.abort(new Error('Acceptance interrupted'))
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  const phase = async (name) => {
    cancellation.signal.throwIfAborted()
    report.phase = name
    report.updatedAt = new Date().toISOString()
    report.warningsObserved = report.warnings + (runtime?.warnings ?? 0)
    if (started) report.elapsedSeconds = Math.round((performance.now() - started) / 1000)
    await saveJson(reportPath, report)
    process.stdout.write(`${report.updatedAt} ${name}\n`)
  }
  const launch = async () => {
    runtime = new PackagedRuntime(app, root, plan.output, cancellation.signal)
    runtime.samples = samples
    return runtime.start()
  }
  const close = async (abnormal = false) => {
    const owned = runtime
    runtime = undefined
    const result = await owned.stop(abnormal)
    report.warnings += result.semaphoreWarnings ?? 0
    report.shutdowns.push(result)
  }
  try {
    await phase('freezing and fingerprinting app resources')
    report.system = await systemInfo()
    original = await fingerprint(await realpath(plan.app))
    report.artifactSha256 = original.sha256
    report.artifactFiles = original.files
    await mkdir(dirname(app))
    await command('/usr/bin/ditto', [plan.app, app])
    copied = await fingerprint(app)
    if (copied.sha256 !== original.sha256)
      throw new Error('Frozen app differs from source artifact')
    await writeFile(
      join(plan.output, 'artifact-manifest.json'),
      JSON.stringify(original, null, 2),
      { mode: 0o600 },
    )
    await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    report.signatureIntegrity = 'passed (does not imply Developer ID or notarization)'
    await prepareDirectories(root)
    samples = createWriteStream(join(plan.output, 'resources.ndjson'), { mode: 0o600 })
    await launch()
    const state = { cold: await coldStart(runtime), witnesses: [] }
    report.coldStart = state.cold
    if (plan.profile === 'real') {
      await phase('importing four offline real models')
      state.models = await importModels(runtime, plan.paths)
      report.models = Object.fromEntries(
        Object.entries(state.models).map(([kind, model]) => [
          kind,
          {
            id: model.id,
            engine: model.engine,
            revision: model.revision,
            artifactIdentity: model.artifactIdentity,
            adapterVersion: model.speech?.adapterVersion,
          },
        ]),
      )
    }
    started = performance.now()
    while (
      (performance.now() - started) / 1000 < plan.duration ||
      report.cycles.length < plan.cycles
    ) {
      const index = report.cycles.length + 1,
        cycleStarted = performance.now()
      await phase(`cycle ${index} starting`)
      const result =
        plan.profile === 'real'
          ? await cycle(runtime, state, (name) => phase(`cycle ${index}: ${name}`))
          : { coldRuntimeAndHost: 'passed' }
      const checkpoint = await runtime.checkpoint()
      const usage = await directoryUsage(root)
      report.checkpoints.push({ cycle: index, epoch: report.shutdowns.length, ...checkpoint })
      report.cycles.push({
        index,
        seconds: Math.round((performance.now() - cycleStarted) / 1000),
        result,
        workspace: usage,
      })
      // Keep the same Supervisor/Node alive for the entire requested duration.
      await phase(`cycle ${index} passed`)
    }
    await phase('final forced-exit cleanup and persistence verification')
    if (state.conversation) {
      await chatTurn(runtime, state.conversation.id, state.models.text.id)
      state.conversation.messages = (
        await runtime.json(`/conversations/${state.conversation.id}`)
      ).messages.length
    }
    await close(true)
    await launch()
    report.persistence.push(await persistence(runtime, state))
    await close()
    if ((await fingerprint(app)).sha256 !== copied.sha256)
      throw new Error('Frozen artifact changed during acceptance')
    report.resourceAssessment = assessResources(report.checkpoints)
    if (report.resourceAssessment.status === 'resource_growth_requires_review')
      throw new Error('Unloaded resource growth exceeded proposed acceptance limits')
    report.elapsedSeconds = Math.round((performance.now() - started) / 1000)
    report.longRunning =
      plan.profile === 'real' &&
      report.elapsedSeconds >= 28800 &&
      report.checkpoints.length >= 8 &&
      report.resourceAssessment.status === 'within_proposed_limits'
        ? report.warnings
          ? 'completed_with_warnings_requiring_review'
          : 'passed_with_scope_limits'
        : 'unverified: duration or real-model samples below 8-hour gate'
    report.status = report.warnings
      ? 'passed_with_warnings_requiring_review'
      : 'passed_with_scope_limits'
  } catch (error) {
    report.status = cancellation.signal.aborted ? 'interrupted' : 'failed'
    report.error = { message: error.message, cause: error.cause?.message }
    throw error
  } finally {
    if (runtime) {
      try {
        await close()
      } catch (error) {
        report.cleanupError = error.message
        report.status = 'failed'
      }
    }
    if (samples) {
      samples.end()
      await once(samples, 'finish')
    }
    report.finishedAt = new Date().toISOString()
    if (started) report.elapsedSeconds = Math.round((performance.now() - started) / 1000)
    await saveJson(reportPath, report)
    process.removeListener('SIGINT', interrupted)
    process.removeListener('SIGTERM', interrupted)
  }
  if (report.status === 'failed') throw new Error(report.cleanupError)
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await verify(options(process.argv.slice(2)))
    process.stdout.write(
      JSON.stringify({
        status: report.status,
        cycles: report.cycles.length,
        elapsedSeconds: report.elapsedSeconds,
        longRunning: report.longRunning,
      }) + '\n',
    )
  } catch (error) {
    process.stderr.write(`Acceptance failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
