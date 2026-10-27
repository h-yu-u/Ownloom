import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Repository } from '../dist/adapters/repository.js'
import { taskSummaries } from '../dist/application/task-summaries.js'

test('task summaries expose stable session identity, title and time without prompt content', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mlx-task-summary-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const owner of ['coding', 'agent']) {
    const repo = new Repository(join(directory, owner))
    try {
      const kind = owner === 'coding' ? 'session' : 'agentSession'
      for (const id of ['first', 'second']) {
        repo.save(kind, { id, title: '同名任务', projectId: 'project' })
        repo.save('run', {
          id: `run-${id}`,
          sessionId: id,
          status: 'completed',
          phase: 'completed',
          text: 'private prompt',
          createdAt: '2026-10-23T14:00:00.000Z',
        })
      }
      const items = taskSummaries(repo, owner)
      assert.equal(items.length, 2)
      assert.equal(items[0].title, '同名任务')
      assert.notEqual(items[0].groupId, items[1].groupId)
      assert.equal(items[0].createdAt, Date.parse('2026-10-23T14:00:00.000Z'))
      assert.equal(items[0].kind, owner)
      assert.ok(!JSON.stringify(items).includes('private prompt'))
      repo.save(kind, { id: 'second', title: '重新命名', projectId: 'project' })
      assert.equal(taskSummaries(repo, owner)[0].title, '重新命名')
    } finally {
      repo.close()
    }
  }
})
