import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const errors = []
const limits = { '.ts': 350, '.vue': 320, '.py': 400, '.rs': 400 }
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await inspect(path)
    else {
      const extension = Object.keys(limits).find((suffix) => path.endsWith(suffix))
      if (
        !extension ||
        /\.spec\.ts$|\.d\.ts$|\/protocol\/generated\/|\/domain\/generated\//.test(path)
      )
        continue
      const length = (await readFile(path, 'utf8')).trimEnd().split('\n').length
      if (length > limits[extension])
        errors.push(`${path}: ${length} lines exceeds ${limits[extension]}`)
    }
  }
}
for (const path of [
  'apps/desktop/src',
  'apps/desktop/src-tauri/src',
  'packages/api-client/src',
  'services/runtime/src',
  'services/coding-agent/src',
])
  await inspect(path)
const publicStyles = await readdir('apps/desktop/src/shared/styles')
for (const name of publicStyles.filter((name) => name.endsWith('.css'))) {
  const source = await readFile(join('apps/desktop/src/shared/styles', name), 'utf8')
  if (/\.(?:chat-|image-|inspector-|composer|message-|model-select)/.test(source))
    errors.push(`${name}: public styles contain feature selectors`)
}
if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exitCode = 1
} else process.stdout.write('Production source length and style ownership checks passed.\n')
