import type { TaskSummary } from '@mlx-studio/api-client'

const terminal = new Set([
  'succeeded',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'available',
  'paused',
  'unavailable',
])
export const taskLabels: Record<string, string> = {
  queued: '排队中',
  preparing: '准备中',
  running: '运行中',
  starting: '启动中',
  awaiting_approval: '等待批准',
  cancelling: '正在停止',
  cancelled: '已取消',
  failed: '失败',
  succeeded: '已完成',
  completed: '已完成',
  interrupted: '已中断',
  downloading: '下载中',
  verifying: '校验中',
  available: '已完成',
  paused: '已暂停',
  unavailable: '连接中断',
  executing: '执行工具',
  exploring: '检查工作区',
  preparing_context: '准备上下文',
  waiting_model: '等待模型',
  loading_model: '加载模型',
  generating: '生成中',
}
const kinds: Record<string, string> = {
  chat: '聊天',
  coding: 'Coding',
  agent: '工具助手',
  image: '图片生成',
  speech: '语音生成',
  download: '模型下载',
  'coding-inference': '模型推理',
  service: '本地服务',
}
export interface TaskGroup {
  key: string
  title: string
  kind: string
  state: string
  phase: string
  target: string
  createdAt: number | null
  needsApproval: boolean
  active: boolean
  primary: TaskSummary
  records: TaskSummary[]
}
export function taskKind(item: TaskSummary): string {
  return kinds[item.kind ?? item.owner] ?? '执行任务'
}
export function taskDate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
function summarizeGroup(key: string, records: TaskSummary[]): TaskGroup {
  records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const roots = records.filter((item) => !item.parentId)
  const candidates = roots.length ? roots : records
  const primary =
    candidates.find((item) => item.needsApproval) ??
    candidates.find((item) => !terminal.has(item.state)) ??
    candidates[0]!
  return {
    key,
    primary,
    records,
    title: primary.title?.trim() || `${taskKind(primary)} · ${primary.id.slice(0, 8)}`,
    kind: taskKind(primary),
    state: primary.state,
    phase:
      (terminal.has(primary.state) && primary.owner !== 'download') ||
      primary.phase === 'accepted' ||
      primary.phase === primary.state
        ? ''
        : (taskLabels[primary.phase] ?? primary.phase),
    target: primary.target,
    createdAt: records[0]?.createdAt ?? null,
    needsApproval: candidates.some((item) => item.needsApproval),
    active: candidates.some((item) => !terminal.has(item.state)),
  }
}
export function groupTasks(items: TaskSummary[]): TaskGroup[] {
  const unique = new Map<string, TaskSummary>()
  for (const item of items)
    if (!unique.has(`${item.owner}:${item.id}`)) unique.set(`${item.owner}:${item.id}`, item)
  const buckets = new Map<string, TaskSummary[]>()
  for (const item of unique.values()) {
    const key =
      item.groupId ||
      (item.sessionId ? `${item.owner}:${item.sessionId}` : `${item.owner}:${item.id}`)
    const records = buckets.get(key) ?? []
    records.push(item)
    buckets.set(key, records)
  }
  return [...buckets]
    .map(([key, records]) => summarizeGroup(key, records))
    .sort(
      (a, b) =>
        Number(b.needsApproval) - Number(a.needsApproval) ||
        Number(b.active) - Number(a.active) ||
        (b.createdAt ?? 0) - (a.createdAt ?? 0),
    )
}
