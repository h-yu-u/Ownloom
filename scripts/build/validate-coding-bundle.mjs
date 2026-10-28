import { verifyCodingBundle } from '../acceptance/verify-coding-bundle.mjs'
import { pruneCodingDependencies } from './coding-bundle-policy.mjs'
import { mkdir, readdir, readFile, realpath, unlink, rm, writeFile } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
if (!process.argv[2] || !process.argv[3])
  throw new Error('Require the deployed Coding bundle and evidence directories')
const root = resolve(process.argv[2])
const evidence = resolve(process.argv[3])
await mkdir(evidence, { recursive: true })
for (const name of ['bundle-size.json', 'bundle-check.json'])
  await rm(join(evidence, name), { force: true })
const { protocolVersion } = JSON.parse(
  await readFile(new URL('../../packages/coding-protocol/schema.json', import.meta.url), 'utf8'),
)
// Legacy pnpm deploy creates a self-link back to the source workspace. It is not a runtime dependency.
await unlink(join(root, 'node_modules/.pnpm/node_modules/@mlx-studio/coding-agent')).catch(
  (error) => {
    if (error.code !== 'ENOENT') throw error
  },
)
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name === '.bin' && entry.isDirectory()) {
      await rm(path, { recursive: true })
      continue
    }
    if (entry.isSymbolicLink()) {
      const target = await realpath(path),
        rel = relative(root, target)
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
        throw new Error(`Bundle link escapes resource root: ${relative(root, path)}`)
    } else if (entry.isDirectory()) await visit(path)
  }
}
await visit(root)
const size = await pruneCodingDependencies(root)
await writeFile(join(evidence, 'bundle-size.json'), JSON.stringify(size, null, 2) + '\n')
process.stdout.write(
  `Coding dependencies: ${size.before.bytes} -> ${size.after.bytes} bytes; removed ${size.removed.files} files (${size.removed.bytes} bytes).\n`,
)
await writeFile(
  join(root, 'provenance.json'),
  JSON.stringify(
    {
      protocolVersion,
      piVersion: size.piVersion,
      nodeVersion: process.versions.node,
      nodeSha256: createHash('sha256')
        .update(await readFile(join(root, 'bin/node')))
        .digest('hex'),
    },
    null,
    2,
  ),
)
const check = await verifyCodingBundle(root)
await writeFile(join(evidence, 'bundle-check.json'), JSON.stringify(check, null, 2) + '\n')
process.stdout.write('Pruned Coding bundle and pinned runtime validated outside the workspace.\n')
