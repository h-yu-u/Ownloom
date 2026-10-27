import { expect, it } from 'vitest'
import type { TaskSummary } from '@mlx-studio/api-client'
import { groupTasks } from './task-groups'

function task(id: string, changes: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    owner: 'runtime',
    title: '同名任务',
    state: 'succeeded',
    phase: 'accepted',
    target: '/chat',
    needsApproval: false,
    ...changes,
  }
}

it('collapses a session and its inference children into one task with the parent status', () => {
  const parent = task('run', {
    owner: 'coding',
    groupId: 'coding:session',
    sessionId: 'session',
    state: 'completed',
    phase: 'generating',
    createdAt: 2,
  })
  const child = task('step', {
    groupId: parent.groupId,
    parentId: parent.id,
    state: 'failed',
    createdAt: 3,
  })
  const items = [child, parent, child]
  const groups = groupTasks(items)
  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ title: '同名任务', state: 'completed', active: false })
  expect(groups[0]!.records).toHaveLength(2)
  expect(groups[0]!.phase).toBe('')
  expect(items).toEqual([child, parent, child])
})

it('uses the latest successful retry instead of a historical failure', () => {
  const groups = groupTasks([
    task('old', { sessionId: 'chat', state: 'failed', createdAt: 1 }),
    task('new', { sessionId: 'chat', state: 'succeeded', createdAt: 2 }),
  ])
  expect(groups).toHaveLength(1)
  expect(groups[0]!.primary.id).toBe('new')
  expect(groups[0]!.state).toBe('succeeded')
})

it('keeps different sessions and owners separate even with identical names', () => {
  const groups = groupTasks([
    task('a', { sessionId: 'first' }),
    task('b', { sessionId: 'second' }),
    task('a', { sessionId: 'first', owner: 'agent' }),
    task('standalone'),
  ])
  expect(groups).toHaveLength(4)
})

it('sorts approval requests first, then active tasks, then recent history', () => {
  const groups = groupTasks([
    task('recent', { createdAt: 100 }),
    task('active', { state: 'running', createdAt: 2 }),
    task('approval', { state: 'awaiting_approval', needsApproval: true, createdAt: 1 }),
  ])
  expect(groups.map((group) => group.primary.id)).toEqual(['approval', 'active', 'recent'])
})
