import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, relative, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const root = resolve(process.argv[2] ?? '.')
const violations = []
const graph = new Map()
const posix = (path) => path.replaceAll('\\', '/')
const rel = (path) => posix(relative(root, path))
const feature = (path) => rel(path).match(/apps\/desktop\/src\/modules\/([^/]+)/)?.[1]
const capability = (path) => rel(path).match(/apps\/desktop\/src\/capabilities\/([^/]+)/)?.[1]
const exists = async (path) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
const configs = new Map()
function compilerOptions(source) {
  const config = ts.findConfigFile(dirname(source), ts.sys.fileExists)
  if (!config) return { moduleResolution: ts.ModuleResolutionKind.NodeNext }
  if (!configs.has(config)) {
    const parse = (path) => {
      const loaded = ts.readConfigFile(path, ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(path))
      if (loaded.error || parsed.errors.length)
        violations.push(`${rel(path)}: invalid TypeScript configuration`)
      return parsed
    }
    const parsed = parse(config)
    const references = (parsed.projectReferences ?? []).map((ref) => {
      const path = ref.path.endsWith('.json') ? ref.path : join(ref.path, 'tsconfig.json')
      return { path, parsed: parse(path) }
    })
    const selected = references.find(
      ({ path, parsed }) =>
        parsed.fileNames.includes(source) ||
        (source.endsWith('.vue') &&
          ts.sys
            .readDirectory(dirname(path), ['.vue'], parsed.raw.exclude, parsed.raw.include)
            .includes(source)),
    )
    configs.set(config, { options: parsed.options, references })
    if (selected) return selected.parsed.options
  }
  const cached = configs.get(config)
  const selected = cached.references.find(
    ({ path, parsed }) =>
      parsed.fileNames.includes(source) ||
      (source.endsWith('.vue') &&
        ts.sys
          .readDirectory(dirname(path), ['.vue'], parsed.raw.exclude, parsed.raw.include)
          .includes(source)),
  )
  return selected?.parsed.options ?? cached.options
}
async function sourceTarget(source, specifier) {
  const options = compilerOptions(source)
  const resolved = ts.resolveModuleName(specifier, source, options, ts.sys).resolvedModule
  const aliases = Object.keys(options.paths ?? {})
  const internal =
    specifier.startsWith('.') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('@mlx-studio/') ||
    aliases.some((key) => {
      const [prefix, suffix] = key.split('*')
      return suffix === undefined
        ? specifier === key
        : specifier.startsWith(prefix) && specifier.endsWith(suffix)
    })
  if (!internal) return undefined
  if (resolved) return resolve(resolved.resolvedFileName)
  // Vue SFCs and workspace source entries are not resolved by TypeScript alone.
  let path
  if (specifier.startsWith('.')) path = resolve(dirname(source), specifier)
  else if (specifier.startsWith('@/')) path = join(root, 'apps/desktop/src', specifier.slice(2))
  else if (specifier === '@mlx-studio/api-client')
    path = join(root, 'packages/api-client/src/index')
  if (path) {
    for (const candidate of [path, `${path}.ts`, `${path}.vue`, join(path, 'index.ts')]) {
      if (await exists(candidate)) return candidate
    }
  }
  violations.push(`${rel(source)}: unresolved internal dependency (${specifier})`)
  return undefined
}
function imports(source, path) {
  const script = path.endsWith('.vue')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((item) => item[1]).join('\n')
    : source
  const ast = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true)
  const dependencies = []
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      dependencies.push(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      dependencies.push(node.arguments[0].text)
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      dependencies.push(node.argument.literal.text)
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast)
      if (
        name === 'fetch' &&
        !rel(path).startsWith('packages/api-client/') &&
        !rel(path).startsWith('services/coding-agent/src/adapters/')
      )
        violations.push(`${rel(path)}: network I/O outside API transport`)
      if (
        rel(path).includes('/stores/') &&
        /(?:setTimeout|setInterval|URL\.(?:create|revoke)ObjectURL)$/.test(name)
      )
        violations.push(`${rel(path)}: Store owns a resource lifecycle`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return dependencies
}
async function inspect(path) {
  const name = rel(path)
  const source = await readFile(path, 'utf8')
  graph.set(path, new Set())
  for (const specifier of imports(source, path)) {
    const target = await sourceTarget(path, specifier)
    if (target) graph.get(path).add(target)
    const targetName = target ? rel(target) : specifier
    const fail = (reason) => violations.push(`${name}: ${reason} (${specifier})`)
    if (
      name.includes('/domain/') &&
      (/@mlx-studio\/api-client|^(?:node:|@earendil-works|vue|pinia|naive-ui|@tauri-apps)/.test(
        specifier,
      ) ||
        /\/(?:application|adapters|stores|infrastructure|presentation|platform|app)\//.test(
          targetName,
        ))
    )
      fail('domain imports UI or infrastructure')
    if (name.includes('/application/') && /\/(?:infrastructure|adapters)\//.test(targetName))
      fail('application imports concrete infrastructure')
    if (name.includes('/presentation/') && /\/infrastructure\//.test(targetName))
      fail('controller imports a concrete adapter')
    if (
      name.includes('/components/') &&
      /(?:\/stores\/|@mlx-studio\/api-client|@tauri-apps)/.test(targetName)
    )
      fail('presentation component imports Store or transport')
    if (feature(path) && target && feature(target) && feature(path) !== feature(target))
      fail('cross-feature internal import')
    if (name.includes('/capabilities/') && /\/(?:modules|app)\//.test(targetName))
      fail('capability depends on feature or app')
    if (name.includes('/shared/') && /\/(?:modules|capabilities|app)\//.test(targetName))
      fail('shared depends on business implementation')
    if (specifier.startsWith('@tauri-apps') && !name.includes('/platform/'))
      fail('native API outside platform adapter')
    if (
      !name.startsWith('apps/desktop/src/app/') &&
      !name.endsWith('/main.ts') &&
      name !== 'apps/desktop/src/App.vue' &&
      targetName.includes('/app/')
    )
      fail('lower layer imports composition root')
    if (
      target &&
      capability(target) &&
      capability(path) !== capability(target) &&
      !name.startsWith('apps/desktop/src/app/') &&
      !targetName.endsWith('/index.ts')
    )
      fail('capability internal import bypasses public entry')
  }
}
async function visit(directory) {
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (/\.(ts|vue)$/.test(path) && !/\.spec\.ts$|\.d\.ts$|\/test-fixtures\//.test(path))
        await inspect(path)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
await visit(join(root, 'apps/desktop/src'))
await visit(join(root, 'packages/api-client/src'))
await visit(join(root, 'services/coding-agent/src'))
const visited = new Set(),
  active = new Set()
function cycles(path) {
  if (active.has(path)) {
    violations.push(`${rel(path)}: dependency cycle`)
    return
  }
  if (visited.has(path)) return
  active.add(path)
  for (const target of graph.get(path) ?? []) cycles(target)
  active.delete(path)
  visited.add(path)
}
for (const path of graph.keys()) cycles(path)
const python = spawnSync(
  'python3',
  [
    fileURLToPath(new URL('./check-python-boundaries.py', import.meta.url)),
    join(root, 'services/runtime/src'),
  ],
  { encoding: 'utf8' },
)
if (python.status !== 0)
  violations.push(python.stdout || python.stderr || 'Python AST checker failed')
if (violations.length) {
  process.stderr.write(`${[...new Set(violations)].join('\n')}\n`)
  process.exitCode = 1
} else process.stdout.write('TypeScript/Vue and Python AST dependency boundaries passed.\n')
