import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const testFiles = ['streaming.test.mjs', 'pi-extensions.test.mjs', 'repository.test.mjs']

function inside(root, path) {
  const fromRoot = relative(root, path)
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
}

async function checkCopiedLinks(root, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      if (!inside(root, await realpath(path)))
        throw new Error(`Copied Coding bundle link escapes isolation: ${relative(root, path)}`)
    } else if (entry.isDirectory()) await checkCopiedLinks(root, path)
  }
}

async function prepareBundle(source, directory) {
  const root = join(directory, 'bundle')
  await cp(source, root, { recursive: true, verbatimSymlinks: true })
  await checkCopiedLinks(root)
  await mkdir(join(root, 'tests/fixtures'), { recursive: true })
  for (const file of [...testFiles, 'fixtures/mcp-server.mjs'])
    await cp(join(repository, 'services/coding-agent/tests', file), join(root, 'tests', file))
  await cp(new URL('./verify-extensions-bundle.mjs', import.meta.url), join(root, 'tests/host.mjs'))
  await mkdir(join(directory, 'home'))
  await mkdir(join(directory, 'tmp'))
  return root
}

function environment(directory) {
  return {
    PATH: '/usr/bin:/bin',
    LANG: 'en_US.UTF-8',
    HOME: join(directory, 'home'),
    PI_CODING_AGENT_DIR: join(directory, 'pi'),
    TMPDIR: join(directory, 'tmp'),
    TMP: join(directory, 'tmp'),
    TEMP: join(directory, 'tmp'),
  }
}

function killGroup(child) {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill('SIGKILL')
    else process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function runNode(root, args, env, signal) {
  signal.throwIfAborted()
  const child = spawn(join(root, 'bin/node'), args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let failure,
    output = ''
  const remember = (chunk, stream) => {
    output = (output + chunk.toString('utf8')).slice(-16000)
    stream.write(chunk)
  }
  child.stdout.on('data', (chunk) => remember(chunk, process.stdout))
  child.stderr.on('data', (chunk) => remember(chunk, process.stderr))
  child.once('error', (error) => {
    failure = error
  })
  const timer = setTimeout(() => {
    failure = new Error('Coding bundle acceptance exceeded 120 seconds')
    killGroup(child)
  }, 120000)
  const interrupt = () => {
    failure = signal.reason
    killGroup(child)
  }
  signal.addEventListener('abort', interrupt, { once: true })
  try {
    const result = await new Promise((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    if (failure || result.code !== 0)
      throw new Error(
        `${failure?.message ?? `Coding bundle check exited with ${result.signal ?? result.code}`}\n${output}`,
      )
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', interrupt)
    killGroup(child)
  }
}

/** Exercise only a copied deployment with its own Node, without workspace dependency fallback. */
export async function verifyCodingBundle(source) {
  const directory = await mkdtemp(join(tmpdir(), 'ownloom-coding-bundle-'))
  const cancellation = new AbortController()
  const interrupt = () => cancellation.abort(new Error('Coding bundle acceptance interrupted'))
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    if (inside(await realpath(repository), await realpath(directory)))
      throw new Error(
        'Coding bundle acceptance requires a temporary directory outside the repository',
      )
    const root = await prepareBundle(await realpath(source), directory)
    const env = environment(directory)
    await runNode(
      root,
      [
        '--input-type=module',
        '--eval',
        "import { verifyExtensionsBundle } from './tests/host.mjs'; await verifyExtensionsBundle(process.cwd())",
      ],
      env,
      cancellation.signal,
    )
    await runNode(
      root,
      [
        '--test',
        '--test-timeout=30000',
        '--test-reporter=tap',
        ...testFiles.map((file) => `tests/${file}`),
      ],
      env,
      cancellation.signal,
    )
    return {
      status: 'passed',
      scope: 'isolated deployed Coding bundle',
      provider: 'loopback mock; no real model',
      checks: {
        hostAndResources: 'passed',
        piStreaming: 'passed',
        mcp: 'passed',
        sqlite: 'passed',
      },
      testFiles,
      unverified: ['real-model inference', 'final app signing and installation'],
    }
  } catch (error) {
    process.stderr.write(`Coding bundle acceptance failed: ${error.message}\n`)
    throw error
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    await rm(directory, { recursive: true, force: true })
  }
}
