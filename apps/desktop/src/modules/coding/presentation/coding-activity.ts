import type { CodingEvent, CodingRun } from '../application/ports'
import { activeStatus } from '../domain/status'
import { commandDescription } from './command-description'
export interface ActivityItem {
  id: string
  label: string
  command?: string
  event: CodingEvent
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}
export type TimelineEntry =
  | { kind: 'message'; key: string; event: CodingEvent }
  | { kind: 'activity'; seq: number; runId: string | null; items: ActivityItem[] }

export function assistantMessageKey(event: CodingEvent): string | null {
  if (!['assistant.delta', 'assistant.message'].includes(event.type)) return null
  const data = event.data
  return data &&
    typeof data === 'object' &&
    'messageId' in data &&
    typeof data.messageId === 'string'
    ? `${event.runId}:${data.messageId}`
    : null
}
export function appendTimelineEvent(events: CodingEvent[], event: CodingEvent): CodingEvent[] {
  const key = assistantMessageKey(event)
  const index = key ? events.findIndex((item) => assistantMessageKey(item) === key) : -1
  if (index < 0) return [...events, event].slice(-100)
  if (event.type === 'assistant.delta' && events[index]?.type === 'assistant.message') return events
  return events.map((item, current) => (current === index ? event : item))
}
export function timelineEntries(
  events: readonly CodingEvent[],
  runs: readonly CodingRun[] = [],
): TimelineEntry[] {
  const result: TimelineEntry[] = [],
    tools = new Map<string, ActivityItem>()
  const messages = new Map<string, Extract<TimelineEntry, { kind: 'message' }>>()
  for (const event of events) {
    if (
      [
        'tool.started',
        'command.started',
        'tool.finished',
        'tool.settled',
        'verification.finished',
      ].includes(event.type)
    ) {
      recordActivity(result, tools, event)
    } else if (
      ['run.started', 'user.steering', 'run.interrupted'].includes(event.type) ||
      (['assistant.delta', 'assistant.message'].includes(event.type) &&
        (event.text.trim() || eventError(event.data)))
    ) {
      const key = assistantMessageKey(event) ?? String(event.seq),
        previous = messages.get(key)
      if (previous) previous.event = event
      else {
        const entry = { kind: 'message' as const, key, event }
        result.push(entry)
        messages.set(key, entry)
      }
    }
  }
  for (const item of tools.values()) {
    const run = runs.find((run) => run.id === item.event.runId)
    if (item.status === 'running' && run && !activeStatus(run.status))
      item.status =
        run.status === 'completed'
          ? 'completed'
          : run.status === 'cancelled' || run.status === 'interrupted'
            ? 'cancelled'
            : 'failed'
  }
  return result
}
function recordActivity(
  result: TimelineEntry[],
  tools: Map<string, ActivityItem>,
  event: CodingEvent,
): void {
  if (isCommandEvidence(event)) return
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  const id = `${event.runId}:${'toolCallId' in data ? String(data.toolCallId) : event.seq}`
  let item = tools.get(id)
  if (!item) {
    item = {
      id,
      event,
      label: event.type === 'verification.finished' ? '执行项目验证' : activityLabel(event.text),
      status: 'running',
    }
    tools.set(id, item)
    const previous = result.at(-1)
    if (previous?.kind === 'activity' && previous.runId === event.runId) previous.items.push(item)
    else result.push({ kind: 'activity', seq: event.seq, runId: event.runId, items: [item] })
  }
  if (event.type !== 'tool.settled' || item.event.type !== 'tool.finished') item.event = event
  if (event.type === 'command.started') {
    item.command = event.text
    item.label = commandDescription(event.text)
  }
  if (!['tool.started', 'command.started'].includes(event.type))
    item.status = activityFailed(data) ? 'failed' : 'completed'
}

function activityFailed(data: object): boolean {
  return ('isError' in data && data.isError === true) || ('errorCode' in data && !!data.errorCode)
}
function isCommandEvidence(event: CodingEvent): boolean {
  const data = event.data
  if (
    event.type !== 'verification.finished' ||
    !data ||
    typeof data !== 'object' ||
    !('value' in data)
  )
    return false
  return (
    !!data.value &&
    typeof data.value === 'object' &&
    'purpose' in data.value &&
    data.value.purpose === 'command'
  )
}
export function eventError(data: unknown): string | null {
  return data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
    ? data.error
    : null
}
export function activityText(event: CodingEvent): string {
  if (event.type === 'verification.finished') return event.text
  if (!event.data || typeof event.data !== 'object' || !('result' in event.data)) return ''
  const result = event.data.result
  if (
    !result ||
    typeof result !== 'object' ||
    !('preview' in result) ||
    typeof result.preview !== 'string'
  )
    return ''
  try {
    const envelope: unknown = JSON.parse(result.preview)
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('content' in envelope) ||
      !Array.isArray(envelope.content)
    )
      return result.preview
    return envelope.content
      .filter(
        (block: unknown): block is { type: string; text: string } =>
          !!block && typeof block === 'object' && 'text' in block && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('\n')
  } catch {
    return result.preview
  }
}
export function activityLabel(name: string): string {
  return (
    (
      {
        list: '浏览项目',
        read: '读取文件',
        search: '搜索代码',
        write: '保存文件',
        edit: '修改代码',
        git_status: '查看 Git 状态',
        run_command: '执行项目命令',
      } as Record<string, string>
    )[name] ?? '调用扩展工具'
  )
}

export function activityItemDescription(item: ActivityItem): string {
  if (item.status === 'running') return `正在${item.label}`
  const state = { completed: '已结束', failed: '失败', cancelled: '已停止' }[item.status]
  return `${item.label} · ${state}`
}

export function activitySummary(items: readonly ActivityItem[]): string {
  const current = items.find((item) => item.status === 'running') ?? items.at(-1)
  if (!current) return '暂无操作'
  const count = items.length > 1 ? ` · ${items.length} 项操作` : ''
  return `${activityItemDescription(current)}${count}`
}
