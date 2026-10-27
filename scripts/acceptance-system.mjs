import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readlink, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join, relative } from 'node:path'

const execute = promisify(execFile)
export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function command(file, args) {
  const result = await execute(file, args, {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  })
  return result.stdout.trim()
}

export function isolatedEnvironment(root, host, token) {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    HOME: join(root, 'home'),
    TMPDIR: join(root, 'tmp') + '/',
    XDG_CACHE_HOME: join(root, 'cache'),
    HF_HOME: join(root, 'cache/huggingface'),
    TORCH_HOME: join(root, 'cache/torch'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    PYTHONPATH: '',
    PYTHONNOUSERSITE: '1',
    MLX_STUDIO_DATA_DIR: join(root, 'data'),
    MLX_STUDIO_CODING_RESOURCES: host,
    MLX_STUDIO_SESSION_TOKEN: token,
    MLX_STUDIO_PARENT_PIPE: '1',
  }
}

export async function saveJson(path, value) {
  const temporary = path + '.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}

async function fileDigest(path) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}

export async function fingerprint(root) {
  const entries = []
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, child.name)
      if (child.isDirectory()) await visit(path)
      else if (child.isSymbolicLink()) {
        const target = relative(root, await realpath(path))
        if (target === '..' || target.startsWith('../') || isAbsolute(target))
          throw new Error('Artifact symlink escapes bundle: ' + relative(root, path))
        entries.push({ path: relative(root, path), link: await readlink(path) })
      } else if (child.isFile())
        entries.push({ path: relative(root, path), sha256: await fileDigest(path) })
      else throw new Error('Unsupported artifact entry: ' + relative(root, path))
    }
  }
  await visit(root)
  return { sha256: digest(JSON.stringify(entries)), files: entries.length, entries }
}

export async function systemInfo() {
  return {
    platform: process.platform,
    architecture: process.arch,
    harnessNode: process.version,
    os: await command('/usr/bin/sw_vers', []),
    hardware: await command('/usr/sbin/sysctl', ['-n', 'hw.model']),
    memoryBytes: Number(await command('/usr/sbin/sysctl', ['-n', 'hw.memsize'])),
  }
}

export function parseProcesses(output) {
  return output.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/)
    return match
      ? [
          {
            pid: +match[1],
            parent: +match[2],
            rssBytes: +match[3] * 1024,
            state: match[4],
            started: match[5],
            command: match[6],
          },
        ]
      : []
  })
}

export async function processTable() {
  return parseProcesses(await command('/bin/ps', ['-axo', 'pid=,ppid=,rss=,stat=,lstart=,comm=']))
}

export function processTree(table, root) {
  const ids = new Set([root])
  let previous = 0
  while (ids.size !== previous) {
    previous = ids.size
    for (const row of table) if (ids.has(row.parent)) ids.add(row.pid)
  }
  return table.filter((row) => ids.has(row.pid))
}

export function sameProcess(left, right) {
  return left.pid === right.pid && left.started === right.started
}

export async function directoryUsage(root) {
  let bytes = 0,
    files = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const usage = await directoryUsage(path)
      bytes += usage.bytes
      files += usage.files
    } else if (entry.isFile()) {
      bytes += (await stat(path)).size
      files++
    }
  }
  return { bytes, files }
}

export async function fileDescriptors(pids) {
  if (!pids.length) return 0
  // Count numeric descriptors, excluding mapped libraries and cwd/text entries.
  const output = await command('/usr/sbin/lsof', ['-nP', '-a', '-p', pids.join(','), '-F', 'f'])
  return output.split('\n').filter((line) => /^f\d/.test(line)).length
}

export function assessResources(samples) {
  const steady = samples.slice(2) // Ignore two complete warm-up cycles.
  if (steady.length < 6) return { status: 'insufficient_samples', samples: steady.length }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const first = steady.slice(0, 3),
    last = steady.slice(-3)
  const rssGrowth = median(last.map((s) => s.rssBytes)) - median(first.map((s) => s.rssBytes))
  const fdGrowth = median(last.map((s) => s.descriptors)) - median(first.map((s) => s.descriptors))
  const processGrowth = median(last.map((s) => s.processes)) - median(first.map((s) => s.processes))
  return {
    status:
      rssGrowth > 256 * 1024 * 1024 || fdGrowth > 16 || processGrowth > 0
        ? 'resource_growth_requires_review'
        : 'within_proposed_limits',
    rssGrowthBytes: rssGrowth,
    descriptorGrowth: fdGrowth,
    processGrowth,
    limits: { rssGrowthBytes: 256 * 1024 * 1024, descriptorGrowth: 16, processGrowth: 0 },
    note: 'Median of last three versus first three unloaded checkpoints, after two warm-up cycles.',
  }
}

export async function prepareDirectories(root) {
  for (const path of ['home', 'tmp', 'cache', 'data', 'work'])
    await mkdir(join(root, path), { recursive: true, mode: 0o700 })
}
