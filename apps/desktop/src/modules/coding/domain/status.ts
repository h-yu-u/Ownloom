export type CodingPermissionMode = 'ask' | 'full'
export type CodingMode = 'analyze' | 'develop' | 'review'
export const modeOptions = [
  { label: '分析（只读）', value: 'analyze' },
  { label: '开发', value: 'develop' },
  { label: '审查（只读）', value: 'review' },
]
export const activeStatus = (status: string): boolean =>
  ['queued', 'starting', 'running', 'awaiting_approval', 'cancelling'].includes(status)
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '下一任务排队中',
    starting: '正在启动',
    running: '执行中',
    awaiting_approval: '等待审批',
    cancelling: '正在停止',
    completed: '任务结束',
    failed: '执行失败',
    cancelled: '已停止',
    interrupted: '进程中断',
    not_run: '未运行检查',
    passed: '检查通过',
    partial: '检查已过期或仅部分完成',
    exploring: '读取与分析',
    editing: '修改文件',
    verifying: '执行验证',
    executing: '执行命令',
    reviewing: '收集结果',
    generating: '正在生成回答',
  }
  return labels[status] ?? status
}

export function isVerified(items: readonly { id: string; status: string }[], id: string): boolean {
  return items.some((item) => item.id === id && item.status === 'verified')
}
