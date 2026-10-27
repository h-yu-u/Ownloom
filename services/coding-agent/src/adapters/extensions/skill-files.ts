import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { loadSkills } from '@earendil-works/pi-coding-agent'
import type { SkillFiles } from '../../extensions/application/ports.js'
import { canonical, resourcePath, type Skill } from '../../extensions/domain/types.js'
export const digest = (value: unknown): string => sha(Buffer.from(canonical(value)))
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const MAX_PACKAGE = 20 * 1024 * 1024
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
export class ManagedSkillFiles implements SkillFiles {
  constructor(private directory: string) {}
  async preview(source: string, workspaces: Skill['workspaces'], requiredCapabilities: string[]) {
    const id = `_preview_${randomUUID().replaceAll('-', '')}`
    try {
      const imported = await this.import(source, id, 1)
      const skill: Skill = {
        ...imported,
        id,
        revision: 1,
        source: 'local-import',
        enabled: true,
        workspaces,
        requiredCapabilities,
      }
      return { skill, body: await this.read(skill, 'SKILL.md'), diagnostics: [] }
    } finally {
      await rm(join(this.directory, id), { recursive: true, force: true })
    }
  }
  async import(source: string, id: string, revision: number) {
    if (!/^[a-z0-9_-]+$/.test(id)) throw new Error('INVALID_EXTENSION_ID')
    if ((await lstat(source)).isSymbolicLink()) throw new Error('SKILL_PATH_NOT_ALLOWED')
    const root = await realpath(source),
      names: string[] = []
    let total = 0,
      directories = 0
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
    try {
      await bytesAt(root, 'SKILL.md', 65536)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        throw new Error('SKILL_FILE_NOT_FOUND')
      throw error
    }
    await walk(root)
    if (!names.includes('SKILL.md')) throw new Error('SKILL_FILE_NOT_FOUND')
    const parent = join(this.directory, id)
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const staging = join(parent, `.staging-${randomUUID()}`)
    await mkdir(staging, { mode: 0o700 })
    const files: Skill['files'] = []
    try {
      for (const name of names.sort()) {
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
      for (const file of files) {
        if (sha(await bytesAt(root, file.relativePath, MAX_PACKAGE)) !== file.digest)
          throw new Error('SKILL_CONTENT_CHANGED')
      }
      const target = join(parent, String(revision))
      try {
        await rename(staging, target)
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          !['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
        )
          throw error
        for (const file of files)
          if (sha(await bytesAt(target, file.relativePath, MAX_PACKAGE)) !== file.digest)
            throw new Error('SKILL_CONTENT_CHANGED')
        await rm(staging, { recursive: true, force: true })
      }
      return {
        name: skill.name,
        description: skill.description,
        files,
        digest: digest(files),
        sourceRef: basename(root),
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }
  async read(skill: Skill, relativePath: string): Promise<string> {
    const file = skill.files.find((item) => item.relativePath === relativePath)
    if (!file || !resourcePath(relativePath)) throw new Error('SKILL_PATH_NOT_ALLOWED')
    let bytes: Buffer
    try {
      const root = await realpath(
        join(this.directory, skill.id, String(skill.contentRevision ?? skill.revision)),
      )
      bytes = await bytesAt(root, relativePath, relativePath === 'SKILL.md' ? 65536 : 262144)
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
}
