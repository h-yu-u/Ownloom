import { command, node, pnpm, task } from './commands.mjs'

export const buildCoding = pnpm('--filter', '@mlx-studio/coding-agent', 'build')
export const bundleCoding = command('bash', 'scripts/build/build-coding-host.sh')

export const codingTasks = {
  'check:coding': task('Type-check the Coding Host.', [
    pnpm('--filter', '@mlx-studio/coding-agent', 'check'),
  ]),
  'test:coding': task('Build and test the Coding Host.', [
    node('--test', 'scripts/build/coding-bundle-policy.spec.mjs'),
    pnpm('--filter', '@mlx-studio/coding-agent', 'test'),
  ]),
  'build:coding': task('Compile the Coding Host.', [buildCoding]),
  'build:coding-bundle': task('Bundle the Host and Node on Apple Silicon macOS.', [bundleCoding]),
}
