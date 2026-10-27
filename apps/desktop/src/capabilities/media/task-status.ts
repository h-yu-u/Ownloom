import { taskLabels, type TaskStatusView, type TaskPhase } from '../../shared/ui/task-status.types'
export function mediaTaskStatus(
  job: { id: string; state: TaskPhase; progress?: number; error_code: string | null },
  options: { cancelling: boolean; syncError: string | null; errorMessage?: string },
): TaskStatusView {
  const terminal = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.state)
  return {
    id: job.id,
    phase: job.state,
    label: taskLabels[job.state],
    connection: options.syncError ? 'disconnected' : 'connected',
    canCancel: !terminal && job.state !== 'cancelling' && !options.cancelling,
    cancelPending: options.cancelling,
    canRetry: false,
    ...(job.state === 'failed'
      ? {
          error: {
            code: job.error_code ?? undefined,
            message: options.errorMessage ?? '生成失败，请检查参数后重新提交',
          },
        }
      : {}),
  }
}
