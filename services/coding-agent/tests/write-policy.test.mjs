import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Repository } from '../dist/adapters/repository.js'
import { Workspace, hash } from '../dist/adapters/workspace.js'
import { tools } from '../dist/adapters/tools.js'
import { RunPolicy } from '../dist/application/run-policy.js'

async function fixture(action) {
  const root = await realpath(await mkdtemp('/tmp/ownloom-write-policy-'))
  const repo = new Repository(join(root, 'data'))
  const project = { id: 'p', path: join(root, 'project'), commands: [], git: false }
  await mkdir(project.path)
  const run = {
    id: 'r',
    sessionId: 's',
    mode: 'develop',
    permissionMode: 'ask',
    status: 'running',
  }
  repo.save('run', run)
  const approvals = []
  const context = new RunPolicy({
    repo,
    project,
    run,
    abort: new AbortController(),
    ports: { workspace: (root, run) => new Workspace(repo, root, run) },
    approvals: {
      request: async (request) => {
        approvals.push(request)
        return false
      },
    },
    update: (patch) => repo.save('run', { ...repo.get('run', run.id), ...patch }),
    command: async () => {
      throw new Error('UNEXPECTED_COMMAND')
    },
  }).context()
  try {
    await action({ root: project.path, tools: tools(context), approvals })
  } finally {
    repo.close()
    await rm(root, { recursive: true, force: true })
  }
}

test('write aliases use the same canonical target for sensitive approval and mutation', () =>
  fixture(async ({ root, tools, approvals }) => {
    await writeFile(join(root, 'package.json'), 'before')
    const write = tools.find((tool) => tool.name === 'write')
    const paths = [
      'package.json',
      'package.json/.',
      './package.json//.',
      'nested/../package.json/.',
      `${root}/package.json/.`,
    ]
    for (const [index, path] of paths.entries()) {
      await assert.rejects(
        write.execute(`write-${index}`, {
          path,
          content: 'after',
          expectedHash: hash('before'),
        }),
        /APPROVAL_DENIED/,
      )
      assert.equal(approvals.at(-1).parameters.path, 'package.json')
      assert.equal(await readFile(join(root, 'package.json'), 'utf8'), 'before')
    }
    assert.equal(approvals.length, paths.length)
  }))

test('edit aliases and case variants cannot bypass sensitive-file approval', () =>
  fixture(async ({ root, tools, approvals }) => {
    const edit = tools.find((tool) => tool.name === 'edit')
    for (const [index, name] of ['package.json', 'PACKAGE.JSON', 'sample.spec.ts'].entries()) {
      await writeFile(join(root, name), 'before')
      await assert.rejects(
        edit.execute(`edit-${index}`, {
          path: `${name}/.`,
          oldText: 'before',
          newText: 'after',
          expectedHash: hash('before'),
        }),
        /APPROVAL_DENIED/,
      )
      assert.equal(approvals.at(-1).parameters.path, name)
      assert.equal(await readFile(join(root, name), 'utf8'), 'before')
    }
  }))

test('ordinary managed writes retain approval-free behavior after canonicalization', () =>
  fixture(async ({ root, tools, approvals }) => {
    await tools
      .find((tool) => tool.name === 'write')
      .execute('ordinary', {
        path: 'nested/../note.txt/.',
        content: 'new note',
        expectedHash: null,
      })
    assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'new note')
    assert.equal(approvals.length, 0)
  }))
