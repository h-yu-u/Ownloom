import { lstat, mkdir, realpath, rename, rm, rmdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  SkillContent,
  SkillFiles,
  SkillPublication,
} from '../../extensions/application/ports.js'
import { canonical, type Skill } from '../../extensions/domain/types.js'
import { copyPackage, readSkill, sha, verifyPackage } from './skill-package.js'

export const digest = (value: unknown): string => sha(Buffer.from(canonical(value)))

async function emptyParent(parent: string): Promise<void> {
  try {
    await rmdir(parent)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code))
    )
      throw error
  }
}

class Publication implements SkillPublication {
  private published = false
  private owned = false
  private committed = false
  constructor(
    readonly value: SkillContent,
    private staging: string,
    private target: string,
    private parent: string,
  ) {}
  read(relativePath: string): Promise<string> {
    return readSkill(this.published ? this.target : this.staging, this.value.files, relativePath)
  }
  async publish(): Promise<void> {
    if (this.published) return
    try {
      await rename(this.staging, this.target)
      this.owned = true
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        !['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
      )
        throw error
      await verifyPackage(this.target, this.value.files)
      await rm(this.staging, { recursive: true, force: true })
    }
    this.published = true
  }
  commit(): void {
    if (!this.published) throw new Error('SKILL_PUBLICATION_NOT_READY')
    this.committed = true
  }
  async abort(): Promise<void> {
    await rm(this.staging, { recursive: true, force: true })
    if (this.owned && !this.committed) {
      await rm(this.target, { recursive: true, force: true })
      this.owned = false
    }
    await emptyParent(this.parent)
  }
}

export class ManagedSkillFiles implements SkillFiles {
  constructor(private directory: string) {}
  async preview(source: string, workspaces: Skill['workspaces'], requiredCapabilities: string[]) {
    const id = `_preview_${randomUUID().replaceAll('-', '')}`
    const publication = await this.stage(source, id, 1)
    try {
      const skill: Skill = {
        ...publication.value,
        id,
        revision: 1,
        source: 'local-import',
        enabled: true,
        workspaces,
        requiredCapabilities,
      }
      return { skill, body: await publication.read('SKILL.md'), diagnostics: [] }
    } finally {
      await publication.abort()
    }
  }
  async stage(source: string, id: string, revision: number): Promise<SkillPublication> {
    if (!/^[a-z0-9_-]+$/.test(id)) throw new Error('INVALID_EXTENSION_ID')
    if ((await lstat(source)).isSymbolicLink()) throw new Error('SKILL_PATH_NOT_ALLOWED')
    const root = await realpath(source),
      parent = join(this.directory, id)
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const staging = join(parent, `.staging-${randomUUID()}`)
    await mkdir(staging, { mode: 0o700 })
    try {
      const imported = await copyPackage(root, staging)
      const value = { ...imported, digest: digest(imported.files), sourceRef: basename(root) }
      return new Publication(value, staging, join(parent, String(revision)), parent)
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      await emptyParent(parent)
      throw error
    }
  }
  async read(skill: Skill, relativePath: string): Promise<string> {
    return readSkill(
      join(this.directory, skill.id, String(skill.contentRevision ?? skill.revision)),
      skill.files,
      relativePath,
    )
  }
}
