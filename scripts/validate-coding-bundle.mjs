import { verifyExtensionsBundle } from './verify-extensions-bundle.mjs'
import { readdir, readFile, realpath, unlink, rm, writeFile } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(process.argv[2])
const { protocolVersion } = JSON.parse(
  await readFile(new URL('../packages/coding-protocol/schema.json', import.meta.url), 'utf8'),
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
const pi = JSON.parse(
  await readFile(join(root, 'node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8'),
)
if (pi.version !== '1.2.0') throw new Error('Unexpected Pi SDK version')
await writeFile(
  join(root, 'provenance.json'),
  JSON.stringify(
    {
      protocolVersion,
      piVersion: pi.version,
      nodeVersion: process.versions.node,
      nodeSha256: createHash('sha256')
        .update(await readFile(join(root, 'bin/node')))
        .digest('hex'),
    },
    null,
    2,
  ),
)
await verifyExtensionsBundle(root)
process.stdout.write('Coding bundle links and pinned runtime validated.\n')
