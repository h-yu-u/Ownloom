import { read, hash } from './workspace.js'

/** A command's meaning includes its configuration, not only the shell command string. */
export async function verificationManifest(root: string): Promise<string> {
  const values: [string, string][] = []
  for (const path of [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'Makefile',
    'pytest.ini',
    'vitest.config.ts',
    'vite.config.ts',
    'tsconfig.json',
    '.nvmrc',
    '.python-version',
    'pnpm-lock.yaml',
    'uv.lock',
  ]) {
    try {
      values.push([path, hash(await read(root, path))])
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      return 'partial:manifest-unavailable'
    }
  }
  return hash(JSON.stringify(values))
}
