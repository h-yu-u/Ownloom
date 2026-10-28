import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { loadSkills } from '@earendil-works/pi-coding-agent'
import { resourcePath, type Skill } from '../../extensions/domain/types.js'

const MAX_PACKAGE = 20 * 1024 * 1024
export const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

async function bytesAt(root: string, name: string, maximum: number): Promise<Buffer> {
  if (!resourcePath(name)) throw new Error('SKILL_PATH_NOT_ALLOWED')
  let path = root
  for (const part of name.split('/')) {
    path = join(path, part)
    if ((await lstat(path)).isSymbolicLink()) throw new Error('SKILL_PATH_NOT_ALLOWED')
  }
  const actual = await realpath(path),
    rel = relative(root, actual)
  if (rel.startsWith('..') || resolve(root, rel) !== actual)
    throw new Error('SKILL_PATH_NOT_ALLOWED')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > maximum) throw new Error('SKILL_RESOURCE_TOO_LARGE')
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (bytes.length > maximum || before.mtimeMs !== after.mtimeMs || before.size !== after.size)
      throw new Error('SKILL_CONTENT_CHANGED')
    return bytes
  } finally {
    await handle.close()
  }
}

async function packageNames(root: string): Promise<string[]> {
  try {
    await bytesAt(root, 'SKILL.md', 65536)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error('SKILL_FILE_NOT_FOUND')
    throw error
  }
  const names: string[] = []
  let directories = 0
  const walk = async (directory: string): Promise<void> => {
    if (++directories > 400 || relative(root, directory).split('/').length > 16)
      throw new Error('SKILL_PACKAGE_TOO_LARGE')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('SKILL_PATH_NOT_ALLOWED')
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        names.push(relative(root, path))
        if (names.length > 200) throw new Error('SKILL_PACKAGE_TOO_LARGE')
      } else throw new Error('SKILL_PATH_NOT_ALLOWED')
    }
  }
  await walk(root)
  return names.sort()
}

export async function verifyPackage(root: string, files: Skill['files']): Promise<void> {
  const names = await packageNames(root)
  if (
    names.join('\0') !==
    files
      .map((file) => file.relativePath)
      .sort()
      .join('\0')
  )
    throw new Error('SKILL_CONTENT_CHANGED')
  for (const file of files)
    if (sha(await bytesAt(root, file.relativePath, MAX_PACKAGE)) !== file.digest)
      throw new Error('SKILL_CONTENT_CHANGED')
}

export async function copyPackage(root: string, staging: string) {
  const names = await packageNames(root),
    files: Skill['files'] = []
  let total = 0
  for (const name of names) {
    const bytes = await bytesAt(root, name, name === 'SKILL.md' ? 65536 : MAX_PACKAGE)
    total += bytes.length
    if (total > MAX_PACKAGE) throw new Error('SKILL_PACKAGE_TOO_LARGE')
    const target = join(staging, name)
    await mkdir(join(target, '..'), { recursive: true, mode: 0o700 })
    await writeFile(target, bytes, { mode: 0o400, flag: 'wx' })
    files.push({ relativePath: name, digest: sha(bytes), size: bytes.length })
  }
  const parsed = loadSkills({
    cwd: staging,
    agentDir: staging,
    skillPaths: [join(staging, 'SKILL.md')],
    includeDefaults: false,
  })
  const skill = parsed.skills[0]
  if (!skill || parsed.diagnostics.length || !skill.description)
    throw new Error('SKILL_FORMAT_UNSUPPORTED')
  await verifyPackage(root, files)
  return { name: skill.name, description: skill.description, files }
}

export async function readSkill(
  root: string,
  files: Skill['files'],
  relativePath: string,
): Promise<string> {
  const file = files.find((item) => item.relativePath === relativePath)
  if (!file || !resourcePath(relativePath)) throw new Error('SKILL_PATH_NOT_ALLOWED')
  let bytes: Buffer
  try {
    bytes = await bytesAt(
      await realpath(root),
      relativePath,
      relativePath === 'SKILL.md' ? 65536 : 262144,
    )
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error('SKILL_CONTENT_CHANGED')
    throw error
  }
  if (sha(bytes) !== file.digest) throw new Error('SKILL_CONTENT_CHANGED')
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.includes('\0')) throw new Error('SKILL_RESOURCE_NOT_TEXT')
    return text
  } catch {
    throw new Error('SKILL_RESOURCE_NOT_TEXT')
  }
}
