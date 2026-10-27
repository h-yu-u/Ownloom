import { parseArgs } from 'node:util'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { once } from 'node:events'
import { resolve, join } from 'node:path'
import { PackagedRuntime } from './acceptance-runtime.mjs'
import { prepareDirectories, saveJson, fingerprint } from './acceptance-system.mjs'
import { migration, history, privacy } from './acceptance-packaged-checks.mjs'
import { faults } from './acceptance-packaged-faults.mjs'

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    output: { type: 'string' },
    python: { type: 'string' },
    only: { type: 'string' },
  },
})
if (!values.app || !values.output || !values.python)
  throw new Error('Require --app --output --python')
if (values.only && !['migration', 'privacy', 'faults', 'history'].includes(values.only))
  throw new Error('Unknown acceptance section')
const app = resolve(values.app),
  output = resolve(values.output),
  python = resolve(values.python)
await mkdir(output, { recursive: false, mode: 0o700 })
const bundle = await fingerprint(app)
const report = {
  status: 'running',
  artifactSha256: bundle.sha256,
  sections: {},
  limitations: [
    'Synthetic legacy-format fixtures, not private production databases.',
    'Fake engines for data and fault injection; real image/speech samples recorded separately.',
    'Native UI/content inspection recorded separately.',
  ],
}
let failed = false
for (const [name, verify] of Object.entries({ migration, privacy, faults, history })) {
  if (values.only && values.only !== name) continue
  const directory = join(output, name)
  await mkdir(directory)
  const root = join(directory, 'workspace')
  await prepareDirectories(root)
  await promisify(execFile)(
    python,
    ['scripts/seed_acceptance_database.py', join(root, 'data/app.db')],
    {
      cwd: process.cwd(),
      env: { PATH: '/usr/bin:/bin', PYTHONPATH: resolve('services/runtime/src') },
      timeout: 30000,
    },
  )
  const samples = createWriteStream(join(directory, 'resources.ndjson'), { mode: 0o600 })
  const context = {
    root,
    output: directory,
    python,
    current: undefined,
    shutdowns: [],
    async start() {
      this.current = new PackagedRuntime(app, root, directory)
      this.current.samples = samples
      await this.current.start()
      return this.current
    },
    async stop(abnormal = false) {
      if (!this.current) return
      const runtime = this.current
      this.current = undefined
      this.shutdowns.push(await runtime.stop(abnormal))
    },
  }
  process.stdout.write('Starting ' + name + '\n')
  try {
    await context.start()
    report.sections[name] = await verify(context)
  } catch (error) {
    failed = true
    report.sections[name] = { status: 'failed', error: error.message, stack: error.stack }
    process.stderr.write(name + ': ' + error.message + '\n')
  } finally {
    try {
      await context.stop()
    } catch (error) {
      failed = true
      report.sections[name].status = 'failed'
      report.sections[name].cleanupError = error.message
    }
    samples.end()
    await once(samples, 'finish')
    report.sections[name].shutdowns = context.shutdowns
    await saveJson(join(output, 'report.json'), report)
  }
}
report.artifactUnchanged = (await fingerprint(app)).sha256 === bundle.sha256
report.status = failed || !report.artifactUnchanged ? 'failed' : 'passed_with_scope_limits'
await saveJson(join(output, 'report.json'), report)
process.stdout.write(
  JSON.stringify({
    status: report.status,
    sections: Object.fromEntries(
      Object.entries(report.sections).map(([key, value]) => [key, value.status]),
    ),
  }) + '\n',
)
if (report.status === 'failed') process.exitCode = 1
