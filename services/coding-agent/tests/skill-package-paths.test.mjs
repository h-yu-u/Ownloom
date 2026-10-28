import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, realpath, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManagedSkillFiles } from '../dist/adapters/extensions/skill-files.js'
import { verifyPackage } from '../dist/adapters/extensions/skill-package.js'

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'ownloom-skill-paths-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const physical = join(temporary, 'physical'),
    alias = join(temporary, 'alias')
  await mkdir(physical)
  await symlink(physical, alias)
  const source = join(alias, 'source')
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: example\ndescription: Path alias fixture\n---\nRead the reference.\n',
  )
  await writeFile(join(source, 'references', 'guide.md'), 'Reference text')
  const files = new ManagedSkillFiles(join(alias, 'managed')),
    publication = await files.stage(source, 'example', 1)
  await publication.publish()
  publication.commit()
  await publication.abort()
  return {
    temporary,
    source,
    files,
    manifest: publication.value.files,
    version: join(alias, 'managed', 'example', '1'),
  }
}

test('identical publications through an ancestor path alias retain the existing version', async (t) => {
  const f = await fixture(t)
  assert.notEqual(f.version, await realpath(f.version))
  const duplicate = await f.files.stage(f.source, 'example', 1)
  try {
    await duplicate.publish()
    assert.equal(await duplicate.read('references/guide.md'), 'Reference text')
  } finally {
    await duplicate.abort()
  }
  assert.deepEqual(await readdir(join(f.version, '..')), ['1'])
  await verifyPackage(f.version, f.manifest)
})

for (const name of ['', 'references', 'references/guide.md']) {
  test(`existing version rejects a symbolic link at ${name || 'its root'}`, async (t) => {
    const f = await fixture(t),
      path = join(f.version, name),
      outside = join(f.temporary, 'outside')
    await rename(path, outside)
    await symlink(outside, path)
    await assert.rejects(verifyPackage(f.version, f.manifest), /SKILL_PATH_NOT_ALLOWED/)
  })
}
