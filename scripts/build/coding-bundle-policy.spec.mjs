import assert from 'node:assert/strict'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pruneCodingDependencies } from './coding-bundle-policy.mjs'

const pi = 'node_modules/@earendil-works/pi-coding-agent'
const cli = `${pi}/dist/bundle`
const manifest = {
  version: '1.2.0',
  main: './dist/index.js',
  exports: { '.': { import: './dist/index.js' } },
}
const sdkFiles = {
  [`${pi}/package.json`]: JSON.stringify(manifest),
  [`${pi}/dist/index.js`]: 'export const fixture = true\n',
}
const sourceMaps = {
  'node_modules/dependency/index.js.map': '{"sources":["源.ts"]}',
  'node_modules/dependency/index.mjs.map': 'module map',
  'node_modules/dependency/index.cjs.map': 'commonjs map',
  'node_modules/dependency/index.d.ts.map': 'declaration map',
  'node_modules/dependency/index.d.mts.map': 'module declaration map',
  'node_modules/dependency/index.d.cts.map': 'commonjs declaration map',
  [`${cli}/cli.js.map`]: 'CLI map counted only as a source map',
}
const declarations = {
  'node_modules/dependency/index.d.ts': 'declare const text: "类型"',
  'node_modules/dependency/index.d.mts': '',
  'node_modules/dependency/index.d.cts': 'export = fixture',
  [`${cli}/cli.d.ts`]: 'CLI declaration counted only as a declaration',
}
const standaloneCli = {
  [`${cli}/cli.js`]: 'standalone CLI',
  [`${cli}/nested/runtime.wasm`]: Buffer.from([0, 97, 115, 109]),
  [`${cli}/package.json`]: '{}',
}
const retained = {
  'node_modules/dependency/resource.map': 'ordinary resource',
  'node_modules/dependency/source.ts': 'TypeScript source',
  'node_modules/dependency/index.js': 'export default 1',
  'node_modules/dependency/config.json': '{"enabled":true}',
  'node_modules/dependency/runtime.wasm': Buffer.from([0, 97, 115, 109]),
  'node_modules/dependency/addon.node': Buffer.from([0, 255, 128]),
  'node_modules/dependency/native.so': Buffer.from([127, 69, 76, 70]),
  'node_modules/dependency/LICENSE': 'license text',
  'node_modules/dependency/NOTICE': 'notice text',
  'node_modules/dependency/index.js.map.backup': 'not a source map suffix',
  'node_modules/dependency/index.d.ts.backup': 'not a declaration suffix',
  'node_modules/other/dist/bundle/cli.js': 'another package bundle',
  [`${pi}/dist/bundle-extra/cli.js`]: 'another Pi directory',
}
const outsideDependencies = {
  'index.js.map': 'root source map',
  'types.d.ts': 'root declaration',
  'fixtures/node_modules/dependency/index.js.map': 'outside deployed dependencies',
  'fixtures/node_modules/dependency/types.d.ts': 'outside declaration',
  '@earendil-works/pi-coding-agent/dist/bundle/cli.js': 'outside standalone CLI',
}
const candidates = {
  'node_modules/aa-candidate.js.map': 'must survive a failed preflight',
  'node_modules/dependency/index.d.ts': 'must also survive',
  [`${cli}/cli.js`]: 'the CLI must survive too',
}

async function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

async function fixture(t, files = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ownloom-coding-prune-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'bundle')
  await writeFiles(root, { ...sdkFiles, ...files })
  return { directory, root }
}

async function assertFiles(root, files) {
  for (const [path, content] of Object.entries(files))
    assert.deepEqual(await readFile(join(root, path)), Buffer.from(content), path)
}

function totals(files) {
  const contents = Object.values(files)
  return {
    files: contents.length,
    bytes: contents.reduce((sum, content) => sum + Buffer.byteLength(content), 0),
  }
}

test('prunes the exact dependency artifacts, preserves runtime files, and is idempotent', async (t) => {
  const removed = { ...sourceMaps, ...declarations, ...standaloneCli }
  const { root } = await fixture(t, { ...retained, ...removed, ...outsideDependencies })
  const link = join(root, 'node_modules/fixture-link')
  await symlink(join(root, 'fixtures'), link, 'dir')
  const after = totals({ ...sdkFiles, ...retained })

  const result = await pruneCodingDependencies(root)
  assert.deepEqual(result, {
    schemaVersion: 1,
    piVersion: '1.2.0',
    measurement: 'regular-file-bytes',
    before: totals({ ...sdkFiles, ...retained, ...removed }),
    after,
    removed: totals(removed),
    categories: {
      sourceMaps: totals(sourceMaps),
      declarations: totals(declarations),
      standaloneCli: totals(standaloneCli),
    },
  })
  await assertFiles(root, { ...sdkFiles, ...retained, ...outsideDependencies })
  for (const path of Object.keys(removed))
    await assert.rejects(lstat(join(root, path)), { code: 'ENOENT' }, path)
  await assert.rejects(lstat(join(root, cli)), { code: 'ENOENT' })
  assert.ok((await lstat(link)).isSymbolicLink(), 'internal links are not traversed or deleted')

  assert.deepEqual(await pruneCodingDependencies(root), {
    ...result,
    before: after,
    removed: { files: 0, bytes: 0 },
    categories: {
      sourceMaps: { files: 0, bytes: 0 },
      declarations: { files: 0, bytes: 0 },
      standaloneCli: { files: 0, bytes: 0 },
    },
  })
})

test('rejects changed Pi versions or entry points before deleting any candidates', async (t) => {
  const scenarios = [
    { manifest: { ...manifest, version: '1.2.1' } },
    { manifest: { ...manifest, main: './dist/replacement.js' } },
    { manifest: { ...manifest, exports: { '.': { import: './dist/replacement.js' } } } },
    { entry: 'missing' },
    { entry: 'link' },
  ]
  for (const scenario of scenarios) {
    const { root } = await fixture(t, candidates)
    if (scenario.manifest)
      await writeFile(join(root, pi, 'package.json'), JSON.stringify(scenario.manifest))
    if (scenario.entry) await unlink(join(root, pi, 'dist/index.js'))
    if (scenario.entry === 'link') {
      await writeFiles(root, { 'replacement.js': 'linked SDK entry' })
      await symlink(join(root, 'replacement.js'), join(root, pi, 'dist/index.js'))
    }
    await assert.rejects(pruneCodingDependencies(root), /version|entry point|ENOENT/i)
    await assertFiles(root, candidates)
  }
})

test('rejects external file and directory links without deleting earlier candidates', async (t) => {
  for (const kind of ['file', 'directory']) {
    const { directory, root } = await fixture(t, candidates)
    const outside = join(directory, 'outside')
    const externalFiles = { 'target.js.map': 'external source map', 'index.js': 'external code' }
    await writeFiles(outside, externalFiles)
    const link = join(root, 'node_modules/zz-external.js.map')
    const target = kind === 'file' ? join(outside, 'target.js.map') : outside
    await symlink(target, link, kind === 'file' ? 'file' : 'dir')

    await assert.rejects(pruneCodingDependencies(root), /link|escapes/i)
    await assertFiles(root, candidates)
    await assertFiles(outside, externalFiles)
    assert.ok((await lstat(link)).isSymbolicLink())
  }
})

test('preflights links inside the standalone CLI before removing its directory', async (t) => {
  const { directory, root } = await fixture(t, candidates)
  const outside = join(directory, 'outside')
  await writeFiles(outside, { 'runtime.js': 'external runtime' })
  const link = join(root, cli, 'zz-external.js')
  await symlink(join(outside, 'runtime.js'), link)

  await assert.rejects(pruneCodingDependencies(root), /link|escapes/i)
  await assertFiles(root, candidates)
  await assertFiles(outside, { 'runtime.js': 'external runtime' })
  assert.ok((await lstat(link)).isSymbolicLink())
})

test('rejects a node_modules symlink even when its target is inside the bundle', async (t) => {
  const { root } = await fixture(t, candidates)
  const dependencies = join(root, 'node_modules')
  await rename(dependencies, join(root, 'physical-dependencies'))
  await symlink(join(root, 'physical-dependencies'), dependencies, 'dir')

  await assert.rejects(pruneCodingDependencies(root), /link|directory/i)
  await assertFiles(root, { ...sdkFiles, ...candidates })
  assert.ok((await lstat(dependencies)).isSymbolicLink())
})
