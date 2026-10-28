import { command, pnpm, task } from './commands.mjs'
import { buildCoding, bundleCoding } from './coding.mjs'
import { buildRuntime } from './runtime.mjs'

const desktop = (...args) => pnpm('--filter', '@mlx-studio/desktop', ...args)
const rustManifest = ['--manifest-path', 'apps/desktop/src-tauri/Cargo.toml']

export const desktopTasks = {
  'dev:desktop': task('Build the Host and start the Tauri desktop.', [
    buildCoding,
    desktop('tauri', 'dev', '--config', 'src-tauri/tauri.dev.conf.json'),
  ]),
  'dev:web': task('Build the Host and start Vite; configure Runtime separately.', [
    buildCoding,
    desktop('dev'),
  ]),
  'check:frontend': task('Run Vue/TypeScript checks and ESLint.', [
    desktop('typecheck'),
    desktop('lint'),
  ]),
  'check:rust': task('Run Rust formatting and clippy checks (platform toolchain required).', [
    command('cargo', 'fmt', '--check', ...rustManifest),
    command('cargo', 'clippy', ...rustManifest, '--', '-D', 'warnings'),
  ]),
  'test:frontend': task('Run frontend Vitest tests.', [desktop('test')]),
  'test:rust': task('Run Rust unit tests (platform toolchain required).', [
    command('cargo', 'test', ...rustManifest),
  ]),
  'build:web': task('Type-check and build the web frontend.', [desktop('build')]),
  'build:app': task('Build the complete app and DMG on Apple Silicon macOS.', [
    bundleCoding,
    desktop('build'),
    buildRuntime,
    { ...desktop('tauri', 'build', '--ci'), env: { CI: 'true' } },
  ]),
}
