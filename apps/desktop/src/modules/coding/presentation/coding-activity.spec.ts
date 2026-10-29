import { expect, it } from 'vitest'
import type { CodingEvent } from '../application/ports'
import { appendTimelineEvent, timelineEntries, activityText } from './coding-activity'
function event(seq: number, type: string, text: string, data: unknown = null): CodingEvent {
  return { seq, type, text, data, sessionId: 's', runId: 'r' }
}
it('replaces cumulative text in place and prevents final content from being duplicated or overwritten by late chunks', () => {
  let events = [event(1, 'run.started', 'original task')]
  for (let index = 2; index < 502; index++)
    events = appendTimelineEvent(
      events,
      event(index, 'assistant.delta', `partial ${index}`, { messageId: 'message' }),
    )
  expect(events).toHaveLength(2)
  events = appendTimelineEvent(
    events,
    event(502, 'assistant.message', 'final reply', { messageId: 'message' }),
  )
  events = appendTimelineEvent(
    events,
    event(503, 'assistant.delta', 'late', { messageId: 'message' }),
  )
  const entries = timelineEntries(events)
  expect(entries).toHaveLength(2)
  expect(entries[1]).toMatchObject({ kind: 'message', event: { text: 'final reply' } })
  expect(entries[0]).toMatchObject({ kind: 'message', event: { text: 'original task' } })
})
it('shows live commands once and attaches completion and output to the same tool call', () => {
  const events = [
    event(1, 'assistant.message', 'I will inspect the project.'),
    event(2, 'tool.started', 'run_command', { toolCallId: 'call' }),
    event(3, 'command.started', 'pnpm test', { toolCallId: 'call' }),
    event(4, 'verification.finished', 'ok', {
      kind: 'verification',
      value: { purpose: 'command' },
    }),
    event(5, 'tool.settled', 'run_command', { toolCallId: 'call', errorCode: null }),
    event(6, 'tool.finished', 'run_command', {
      toolCallId: 'call',
      result: { preview: 'command output' },
    }),
  ]
  const live = timelineEntries(events.slice(0, 3))
  expect(live[1]).toMatchObject({
    kind: 'activity',
    items: [{ status: 'running', label: '运行项目测试', command: 'pnpm test' }],
  })
  const done = timelineEntries(events)
  expect(done).toHaveLength(2)
  if (done[1]?.kind !== 'activity') throw new Error('Missing activity')
  expect(done[1].items).toHaveLength(1)
  expect(done[1].items[0]?.status).toBe('completed')
  expect(activityText(done[1].items[0]!.event)).toBe('command output')
})

it('preserves the explanation and raw command after completion, with output available separately', () => {
  const command = 'npm view vue@2 version'
  const entries = timelineEntries([
    event(1, 'tool.started', 'run_command', { toolCallId: 'call' }),
    event(2, 'command.started', command, { toolCallId: 'call' }),
    event(3, 'tool.finished', 'run_command', { toolCallId: 'call', result: { preview: '2.7.16' } }),
  ])
  expect(entries[0]).toMatchObject({
    items: [{ label: '查询 Vue 的可用版本', command, status: 'completed' }],
  })
})
