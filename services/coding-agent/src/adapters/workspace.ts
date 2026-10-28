import type { WorkspaceVersions } from './workspace-version.js'
import { constants } from 'node:fs'
import { open, lstat, realpath, readdir, mkdir } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Change, Project, Run } from '../domain/types.js'
import type { RepositoryPort } from '../application/ports.js'
const execute = promisify(execFile)
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const blocked =
  /^(?:\.git|\.env(?:\..*)?|\.venv|node_modules|dist|build|\.build|target|\.ssh|\.aws|\.pi|\.npmrc|\.netrc|\.git-credentials|id_rsa.*|id_ed25519.*|credentials.*|secrets?.*|.*\.(?:pem|key|p12|pfx))$/i
const limit = 512 * 1024
export async function safePath(root: string, path: string, create = false): Promise<string> {
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('WORKSPACE_ROOT_CHANGED')
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(rel)
  )
    throw new Error('PATH_OUTSIDE_WORKSPACE')
  const parts = rel.split('/')
  if (parts.some((part) => blocked.test(part))) throw new Error('PATH_EXCLUDED')
  let current = root
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index])
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error('SYMLINK_REJECTED')
      if (index < parts.length - 1 && !info.isDirectory()) throw new Error('INVALID_PARENT')
    } catch (error) {
      if (create && error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return target
}
export async function read(root: string, path: string): Promise<string> {
  const target = await safePath(root, path)
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) throw new Error('FILE_TOO_LARGE_OR_NOT_TEXT')
    await safePath(root, path)
    const current = await lstat(target)
    if (current.ino !== info.ino || current.dev !== info.dev)
      throw new Error('FILE_VERSION_CONFLICT')
    const bytes = await file.readFile()
    if (bytes.includes(0)) throw new Error('BINARY_FILE_REJECTED')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    await file.close()
  }
}
export async function files(root: string, path = '.', strict = false): Promise<string[]> {
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('WORKSPACE_ROOT_CHANGED')
  const directory = path === '.' ? root : await safePath(root, path)
  const found: string[] = []
  async function walk(folder: string, depth: number): Promise<void> {
    if (strict && (depth > 32 || found.length >= 100000))
      throw new Error('WORKSPACE_FINGERPRINT_LIMIT')
    if (depth > (strict ? 32 : 6) || found.length >= 100000) return
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (blocked.test(entry.name) || entry.isSymbolicLink()) continue
      const child = join(folder, entry.name)
      if (entry.isDirectory()) await walk(child, depth + 1)
      else if (entry.isFile()) found.push(relative(root, child))
      if (found.length >= 100000) break
    }
  }
  await walk(directory, 0)
  if (strict && found.length >= 100000) throw new Error('WORKSPACE_FINGERPRINT_LIMIT')
  return found
}
export async function git(
  root: string,
  action: 'status' | 'diff' | 'branch' | 'root',
): Promise<string> {
  const args = {
    status: ['status', '--porcelain=v1', '-uall'],
    diff: [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      'HEAD',
      '--',
      '.',
      ':(exclude)*.env*',
      ':(exclude)*.pem',
      ':(exclude)*.key',
    ],
    branch: ['branch', '--show-current'],
    root: ['rev-parse', '--show-toplevel'],
  }[action]
  const query = async (parameters: string[]): Promise<string> => {
    try {
      const result = await execute(
        '/usr/bin/git',
        ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...parameters],
        {
          cwd: root,
          env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
          maxBuffer: 512 * 1024,
          timeout: 10000,
        },
      )
      return result.stdout.trim()
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      )
        return 'partial:GIT_OUTPUT_LIMIT'
      throw error
    }
  }
  if (action === 'diff') {
    try {
      await query(['rev-parse', '--verify', 'HEAD'])
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 128)) throw error
      // An unborn repository still has staged and working-tree changes to review.
      const format = await query(['rev-parse', '--show-object-format'])
      const emptyTree = createHash(format).update('tree 0\0').digest('hex')
      return query(args.map((arg) => (arg === 'HEAD' ? emptyTree : arg)))
    }
  }
  return query(args)
}
export async function registerProject(path: string): Promise<Project> {
  const root = await realpath(path)
  if (!(await lstat(root)).isDirectory()) throw new Error('PROJECT_DIRECTORY_REQUIRED')
  let isGit = false,
    branch = '',
    dirty = ''
  try {
    await git(root, 'root')
    isGit = true
    branch = await git(root, 'branch')
    dirty = await git(root, 'status')
  } catch {
    /* Non-Git projects support managed file tools. */
  }
  let instructions = ''
  try {
    instructions = (await read(root, 'AGENTS.md')).slice(0, 16000)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  return {
    id: randomUUID(),
    path: root,
    name: root.split('/').at(-1) ?? root,
    git: isGit,
    branch,
    dirty,
    instructions,
    commands: [],
  }
}
export async function fingerprint(root: string, versions: WorkspaceVersions): Promise<string> {
  const capture = versions.begin(root)
  const digest = createHash('sha256')
  let paths: string[]
  try {
    paths = (await files(root, '.', true)).sort()
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKSPACE_ROOT_CHANGED') throw error
    return capture.finish('partial:index-unavailable')
  }
  if (paths.length >= 100000) return capture.finish('partial:file-limit')
  let bytesRead = 0
  for (const path of paths) {
    let target: string, file
    try {
      target = await safePath(root, path)
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch {
      return capture.finish('partial:file-unavailable')
    }
    try {
      const info = await file.stat()
      bytesRead += info.size
      if (!info.isFile() || info.size > 64 * 1024 * 1024 || bytesRead > 256 * 1024 * 1024)
        return capture.finish(`partial:${digest.digest('hex')}`)
      const content = createHash('sha256')
      for await (const bytes of file.createReadStream({ autoClose: false })) content.update(bytes)
      const after = await file.stat()
      if (after.mtimeMs !== info.mtimeMs || after.size !== info.size)
        throw new Error('FILE_VERSION_CONFLICT')
      await capture.file(target, after)
      digest.update(path).update(content.digest('hex'))
    } catch {
      return capture.finish('partial:file-changed')
    } finally {
      await file.close()
    }
  }
  return capture.finish(digest.digest('hex'))
}
export class Workspace {
  constructor(
    private repo: RepositoryPort,
    readonly root: string,
    private run: Run,
  ) {}
  async write(path: string, content: string, expected: string | null): Promise<string> {
    if (this.run.mode !== 'develop') throw new Error('READ_ONLY_MODE')
    if (Buffer.byteLength(content) > limit || content.includes('\0'))
      throw new Error('FILE_TOO_LARGE_OR_NOT_TEXT')
    const target = await safePath(this.root, path, true)
    let before: string | null = null
    try {
      before = await read(this.root, path)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    if ((before === null ? null : hash(before)) !== expected)
      throw new Error('FILE_VERSION_CONFLICT')
    const change: Change = {
      id: randomUUID(),
      runId: this.run.id,
      sessionId: this.run.sessionId,
      path: relative(this.root, target),
      before,
      after: content,
      restored: false,
      state: 'pending',
    }
    this.repo.save('change', change)
    await mkdir(dirname(target), { recursive: true })
    await safePath(this.root, path, true)
    const file = await open(
      target,
      constants.O_RDWR |
        constants.O_NOFOLLOW |
        (before === null ? constants.O_CREAT | constants.O_EXCL : 0),
      0o644,
    )
    try {
      await safePath(this.root, path)
      const pathInfo = await lstat(target),
        fileInfo = await file.stat()
      if (pathInfo.ino !== fileInfo.ino || pathInfo.dev !== fileInfo.dev)
        throw new Error('FILE_VERSION_CONFLICT')
      const current = await file.readFile('utf8')
      if (before !== null && hash(current) !== expected) throw new Error('FILE_VERSION_CONFLICT')
      await file.write(content, 0, 'utf8')
      await file.truncate(Buffer.byteLength(content))
      await file.sync()
    } finally {
      await file.close()
    }
    this.repo.save('change', { ...change, state: 'written' }, 'file.changed', path)
    return hash(content)
  }
}

export async function instructions(root: string): Promise<string> {
  try {
    return await read(root, 'AGENTS.md')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  }
}
