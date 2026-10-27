import type { ChatMessage } from './chat-state'

export function regenerationMode(
  message?: ChatMessage,
): 'refresh_web' | 'reuse_context' | 'local_only' {
  if (message?.sources?.some((source) => source.kind === 'web')) return 'refresh_web'
  return typeof message?.parameters?.contextJobId === 'string' ? 'reuse_context' : 'local_only'
}
