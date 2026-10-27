import type { CodingRun } from '@mlx-studio/api-client'
import {
  taskLabels,
  type TaskStatusView,
  type TaskPhase,
} from '../../../shared/ui/task-status.types'
import { extensionError } from './errors'
export function agentTaskStatus(
  run: CodingRun,
  pending: boolean,
  disconnected = false,
): TaskStatusView {
  const phase: TaskPhase =
    run.status === 'completed'
      ? 'succeeded'
      : run.status === 'starting'
        ? 'preparing'
        : run.status === 'awaiting_approval'
          ? 'awaiting-approval'
          : run.status
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)
  return {
    id: run.id,
    phase,
    label: taskLabels[phase],
    connection: disconnected ? 'disconnected' : 'connected',
    canCancel: !terminal && phase !== 'cancelling' && !pending,
    cancelPending: !terminal && pending,
    canRetry: false,
    ...(run.status === 'failed' || run.status === 'interrupted'
      ? {
          error: {
            message: run.error
              ? extensionError(new Error(run.error))
              : run.status === 'interrupted'
                ? '运行已中断，可重新提交任务'
                : '任务执行失败',
          },
        }
      : {}),
  }
}
export function agentEventLabel(type: string): string {
  return (
    (
      {
        'run.started': '开始执行',
        'assistant.message': '助手回复',
        'tool.started': '调用工具',
        'tool.settled': '工具完成',
        'tool.finished': '工具完成',
        'skill.loaded': '已读取技能',
      } as Record<string, string>
    )[type] ?? '运行详情'
  )
}
