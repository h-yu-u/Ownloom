import { command, node, pnpm, task, uv } from './commands.mjs'
import { checkRpc } from './contracts.mjs'
import { pythonSources } from './runtime.mjs'

const sourcePatterns = [
  'apps/desktop/src/**/*.{ts,vue,css}',
  'packages/api-client/src/**/*.ts',
  'scripts/**/*.mjs',
  'services/coding-agent/src/**/*.ts',
  'services/coding-agent/tests/*.mjs',
  'apps/desktop/vite.config.ts',
]
const markdownPatterns = ['*.md', 'docs/**/*.md']
const formatting = (check) => [
  pnpm('exec', 'prettier', check ? '--check' : '--write', ...sourcePatterns),
  uv('ruff', 'format', ...(check ? ['--check'] : []), ...pythonSources),
]

export const repositoryTasks = {
  bootstrap: task('Install locked dependencies and Apple Silicon inference extras.', [
    pnpm('install', '--frozen-lockfile'),
    command(
      'uv',
      'sync',
      '--project',
      'services/runtime',
      '--frozen',
      '--extra',
      'mlx-vlm',
      '--extra',
      'mflux',
      '--extra',
      'audio',
    ),
  ]),
  'check:docs': task('Test documentation checks, verify links, and check Markdown formatting.', [
    node('--test', 'scripts/checks/check-docs.spec.mjs'),
    node('scripts/checks/check-docs.mjs'),
    pnpm('exec', 'prettier', '--check', ...markdownPatterns),
  ]),
  'check:format': task('Check source formatting with Prettier and Ruff.', formatting(true)),
  'check:boundaries': task('Check RPC drift, dependency boundaries, and source quality.', [
    checkRpc,
    node('--test', 'scripts/checks/check-boundaries.spec.mjs'),
    node('scripts/checks/check-boundaries.mjs'),
    node('scripts/checks/check-source-quality.mjs'),
  ]),
  'test:tooling': task('Test command selection, process behavior, and argument forwarding.', [
    node('--test', 'scripts/tasks/run.spec.mjs'),
  ]),
  format: task('Format the same source files checked by check format.', formatting(false)),
  'format:docs': task('Format root and docs Markdown files.', [
    pnpm('exec', 'prettier', '--write', ...markdownPatterns),
  ]),
}
