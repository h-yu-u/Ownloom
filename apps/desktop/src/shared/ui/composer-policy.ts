export type ComposerAction = 'submit' | 'steer' | 'queue' | 'cancel'
export interface ComposerActionState {
  action: ComposerAction
  label: string
  enabled: boolean
  reason?: string
  pending: boolean
}
export function composerShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'isComposing' | 'repeat' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'keyCode'
  >,
  mode: 'enter' | 'modifier-enter',
  composing = false,
): 'ignore' | 'trigger' | 'repeat' {
  if (
    event.key !== 'Enter' ||
    composing ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.shiftKey ||
    event.altKey
  )
    return 'ignore'
  const modifier = event.ctrlKey || event.metaKey
  if (mode === 'enter' ? modifier : !modifier) return 'ignore'
  return event.repeat ? 'repeat' : 'trigger'
}
export function codingPrimary(input: {
  text: string
  enabled: boolean
  ready: boolean
  pending: boolean
  busy: boolean
  current: boolean
  status?: string
}): ComposerActionState {
  const action = input.busy ? (input.current ? 'steer' : 'queue') : 'submit'
  const reason = !input.enabled
    ? '请选择未归档的会话'
    : !input.ready
      ? '请选择可用模型'
      : input.pending
        ? '正在处理请求'
        : !input.text.trim()
          ? '请输入任务'
          : input.current && ['starting', 'queued', 'cancelling'].includes(input.status ?? '')
            ? input.status === 'cancelling'
              ? '正在停止任务'
              : '任务正在准备'
            : undefined
  return {
    action,
    label: action === 'steer' ? '补充当前任务' : action === 'queue' ? '申请排队' : '发送',
    enabled: !reason,
    reason,
    pending: input.pending,
  }
}
