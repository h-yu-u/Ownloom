export type TaskPhase =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'awaiting-approval'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
export interface TaskStatusView {
  id: string
  phase: TaskPhase
  label: string
  detail?: string
  connection: 'connected' | 'syncing' | 'disconnected'
  progress?: { completed: number; total: number; unit: string }
  error?: { code?: string; message: string; requestId?: string }
  canCancel: boolean
  cancelPending: boolean
  canRetry: boolean
}
export const taskLabels: Record<TaskPhase, string> = {
  queued: '等待运行',
  preparing: '正在准备',
  running: '正在执行',
  'awaiting-approval': '等待确认',
  cancelling: '正在取消',
  succeeded: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
  interrupted: '任务已中断',
}
