import { lstat, readdir, readFile, realpath, rm, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

const piDirectory = 'node_modules/@earendil-works/pi-coding-agent'
const cliDirectory = `${piDirectory}/dist/bundle`

function category(path) {
  if (/\.(?:[cm]?js|d\.(?:ts|mts|cts))\.map$/.test(path)) return 'sourceMaps'
  if (/\.d\.(?:ts|mts|cts)$/.test(path)) return 'declarations'
  if (path.startsWith(`${cliDirectory}/`)) return 'standaloneCli'
  return null
}

async function checkPiLayout(root) {
  // The deploy command deliberately uses a hoisted layout. Never prune through links.
  for (const path of [
    'node_modules',
    'node_modules/@earendil-works',
    piDirectory,
    `${piDirectory}/dist`,
  ]) {
    if (!(await lstat(join(root, path))).isDirectory())
      throw new Error(`Coding bundle directory must not be a link: ${path}`)
  }
  const pi = JSON.parse(await readFile(join(root, piDirectory, 'package.json'), 'utf8'))
  if (pi.version !== '1.2.0') throw new Error(`Unexpected Pi SDK version: ${pi.version}`)
  if (pi.main !== './dist/index.js' || pi.exports?.['.']?.import !== './dist/index.js')
    throw new Error('Unexpected Pi SDK entry point; review the Coding bundle policy')
  if (!(await lstat(join(root, piDirectory, 'dist/index.js'))).isFile())
    throw new Error('Pi SDK entry point must be a regular file')
  const cli = await lstat(join(root, cliDirectory)).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (cli && !cli.isDirectory()) throw new Error('Pi standalone CLI must be a real directory')
  return pi.version
}

async function inventory(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const name = relative(root, path).split(sep).join('/')
      if (entry.isSymbolicLink()) {
        const target = relative(root, await realpath(path))
        if (target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target))
          throw new Error(`Bundle link escapes resource root: ${name}`)
      } else if (entry.isDirectory()) await visit(path)
      else if (entry.isFile())
        files.push({ path, bytes: (await lstat(path)).size, category: category(name) })
      else throw new Error(`Unsupported Coding bundle entry: ${name}`)
    }
  }
  await visit(join(root, 'node_modules'))
  return files
}

const totals = (files) => ({
  files: files.length,
  bytes: files.reduce((sum, file) => sum + file.bytes, 0),
})

/** Prune only the deployed dependencies, after checking every candidate and link. */
export async function pruneCodingDependencies(bundleRoot) {
  const root = await realpath(bundleRoot)
  const piVersion = await checkPiLayout(root)
  const before = await inventory(root)
  const removed = before.filter((file) => file.category !== null)
  const categories = Object.fromEntries(
    ['sourceMaps', 'declarations', 'standaloneCli'].map((name) => [
      name,
      totals(removed.filter((file) => file.category === name)),
    ]),
  )
  for (const file of removed) await unlink(file.path)
  await rm(join(root, cliDirectory), { recursive: true, force: true })
  const after = await inventory(root)
  if (after.some((file) => file.category !== null))
    throw new Error('Coding bundle still contains files excluded by its policy')
  return {
    schemaVersion: 1,
    piVersion,
    measurement: 'regular-file-bytes',
    before: totals(before),
    after: totals(after),
    removed: totals(removed),
    categories,
  }
}
