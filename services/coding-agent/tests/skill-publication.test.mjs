import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ExtensionsRepository } from '../dist/adapters/extensions/repository.js'
import { ManagedSkillFiles, digest } from '../dist/adapters/extensions/skill-files.js'
import { Extensions } from '../dist/extensions/application/service.js'

const body = (text) =>
  `---\nname: example\ndescription: Isolated publication fixture\n---\n${text}\n`
async function fixture(t) {
  const root = await mkdtemp('/tmp/ownloom-skill-publication-'),
    source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'SKILL.md'), body('version one'))
  const repo = new ExtensionsRepository(root),
    files = new ManagedSkillFiles(join(root, 'managed'))
  const service = new Extensions({ repo, files, digest, mcp: {}, revokeRuns: async () => {} })
  t.after(async () => {
    await service.close()
    await rm(root, { recursive: true, force: true })
  })
  const request = { path: source, workspaces: ['coding'], requiredCapabilities: [] }
  const first = await service.dispatch('extensions.skills.import', {
    ...request,
    mutationId: 'first',
  })
  return { root, source, repo, files, service, request, skill: repo.skill(first.targetId) }
}

test('a stale preview does not occupy the revision needed by a corrected publication', async (t) => {
  const f = await fixture(t)
  const request = { ...f.request, id: f.skill.id, expectedRevision: 1 }
  await writeFile(join(f.source, 'SKILL.md'), body('changed after preview'))
  await assert.rejects(
    f.service.dispatch('extensions.skills.publish', {
      ...request,
      mutationId: 'stale',
      expectedDigest: f.skill.digest,
    }),
    /SKILL_CONTENT_CHANGED/,
  )
  assert.deepEqual(await readdir(join(f.root, 'managed', f.skill.id)), ['1'])
  await writeFile(join(f.source, 'SKILL.md'), body('corrected content'))
  const preview = await f.service.dispatch('extensions.skills.preview', f.request)
  const published = await f.service.dispatch('extensions.skills.publish', {
    ...request,
    mutationId: 'corrected',
    expectedDigest: preview.skill.digest,
  })
  assert.equal(published.revision, 2)
  assert.match(await f.files.read(f.repo.skill(f.skill.id), 'SKILL.md'), /corrected content/)
})

test('repository rejection rolls back only the newly published version and permits retry', async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.source, 'SKILL.md'), body('new content'))
  const commit = f.repo.commit.bind(f.repo)
  f.repo.commit = () => {
    throw new Error('ISOLATED_COMMIT_FAILURE')
  }
  await assert.rejects(
    f.service.dispatch('extensions.skills.publish', {
      ...f.request,
      id: f.skill.id,
      expectedRevision: 1,
      mutationId: 'failed-commit',
    }),
    /ISOLATED_COMMIT_FAILURE/,
  )
  f.repo.commit = commit
  assert.equal(f.repo.skill(f.skill.id).revision, 1)
  assert.deepEqual(await readdir(join(f.root, 'managed', f.skill.id)), ['1'])
  assert.match(await f.files.read(f.repo.skill(f.skill.id), 'SKILL.md'), /version one/)
  await writeFile(join(f.source, 'SKILL.md'), body('retry content'))
  const result = await f.service.dispatch('extensions.skills.publish', {
    ...f.request,
    id: f.skill.id,
    expectedRevision: 1,
    mutationId: 'retry',
  })
  assert.equal(result.revision, 2)
})

test('name conflicts and previews leave no published version or temporary directory', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    f.service.dispatch('extensions.skills.import', { ...f.request, mutationId: 'conflict' }),
    /SKILL_NAME_CONFLICT/,
  )
  await f.service.dispatch('extensions.skills.preview', f.request)
  assert.deepEqual(await readdir(join(f.root, 'managed')), [f.skill.id])
  assert.deepEqual(await readdir(join(f.root, 'managed', f.skill.id)), ['1'])
})

test('aborting an identical existing version does not delete files owned by another publication', async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.source, 'SKILL.md'), body('previously published content'))
  const existing = await f.files.stage(f.source, f.skill.id, 2)
  await existing.publish()
  existing.commit()
  await existing.abort()
  const commit = f.repo.commit.bind(f.repo)
  f.repo.commit = () => {
    throw new Error('ISOLATED_COMMIT_FAILURE')
  }
  await assert.rejects(
    f.service.dispatch('extensions.skills.publish', {
      ...f.request,
      id: f.skill.id,
      expectedRevision: 1,
      mutationId: 'failed-adoption',
    }),
    /ISOLATED_COMMIT_FAILURE/,
  )
  f.repo.commit = commit
  assert.deepEqual(await readdir(join(f.root, 'managed', f.skill.id)), ['1', '2'])
  const result = await f.service.dispatch('extensions.skills.publish', {
    ...f.request,
    id: f.skill.id,
    expectedRevision: 1,
    mutationId: 'adopt',
  })
  assert.equal(result.revision, 2)
  assert.match(
    await f.files.read(f.repo.skill(f.skill.id), 'SKILL.md'),
    /previously published content/,
  )
})
